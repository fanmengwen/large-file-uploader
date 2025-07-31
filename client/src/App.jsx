import { useState, useMemo, useRef } from "react";
import axios from "axios"; // 引入 axios

import "./App.css";

const API_URL = "http://localhost:3000";
const CHUNK_SIZE = 2 * 1024 * 1024; // 5MB

function App() {
  const [file, setFile] = useState(null);
  const [hashProgress, setHashProgress] = useState(0);
  const [chunks, setChunks] = useState([]);

  // 使用 useRef 来存储每个请求的 AbortController
  const controllerRef = useRef({});

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setFile(file);
  };

  const handleUpload = async () => {
    if (!file) {
      alert("请选择文件");
      return;
    }

    //1. 切片 chunks
    const chunks = createFileChunks(file, CHUNK_SIZE);

    //2. 计算 hash
    const hash = await calcaulateFileHash(chunks);

    const { data } = await axios.post(`${API_URL}/verify`, {
      filename: file.name,
      fileHash: hash,
    });

    const { shouldUpload, message, uploadedList } = data;

    if (!shouldUpload) {
      alert(message || "文件已存在，秒传成功！");
      return; // 结束上传流程
    }

    const allChunks = chunks.map((c, index) => {
      return {
        chunk: c.fileChunk,
        hash: `${hash}-${index}`,
        size: c.fileChunk.size,
        progress: uploadedList.includes(`${hash}-${index}`) ? 100 : 0, // 标记已上传的
      };
    });

    setChunks(allChunks);
    await uploadChunks(allChunks, hash, uploadedList);
  };

  const uploadChunks = async (chunksToUpload, fileHash, uploadedList) => {
    const requests = chunksToUpload
      // 过滤掉已经上传的切片
      .filter((chunk) => !uploadedList.includes(chunk.hash))
      .map((chunk) => {
        const controller = new AbortController();
        controllerRef.current[chunk.hash] = controller; // 存储 controller

        const formData = new FormData();
        formData.append("chunk", chunk.chunk);
        formData.append("hash", fileHash); // 整个文件的 hash
        formData.append("chunkHash", chunk.hash); // 当前切片的 hash
        return axios.post(`${API_URL}/upload`, formData, {
          signal: controller.signal, // 关联 signal
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );

            // 更新对应切片的进度
            setChunks((prevChunks) => {
              return prevChunks.map((c) => {
                if (c.hash === chunk.hash) {
                  return { ...c, progress: percentCompleted };
                }
                return c;
              });
            });
          },
        });
      });

    await Promise.all(requests);
    alert("所有切片上传完毕!");

    await axios.post(`${API_URL}/merge`, {
      fileHash: fileHash,
      filename: file.name,
      size: CHUNK_SIZE, // 将切片大小告诉后端
    });

    alert(`文件 "${file.name}" 上传成功!`);
  };

  const createFileChunks = (file, chunkSize) => {
    const chunks = [];
    let index = 0;
    for (let i = 0; i < file.size; i += chunkSize) {
      chunks.push({
        fileChunk: file.slice(i, i + chunkSize),
        index,
      });
      index++;
    }
    return chunks;
  };

  const calcaulateFileHash = (chunks) => {
    return new Promise((resolve) => {
      // 创建一个 Web Worker。浏览器会异步下载并执行这个 JS 文件。路径 /hash.js 是相对于 public 目录的根路径
      const worker = new Worker("/hash.js");
      worker.postMessage({ chunks });

      worker.onmessage = (e) => {
        const { hash, progress } = e.data;
        setHashProgress(progress); // 更新 hash 计算进度
        if (hash) {
          resolve(hash); // 当 hash 计算完成时，Promise resolve
        }
      };
    });
  };

  const handlePause = () => {
    console.log("执行暂停");

    Object.values(controllerRef.current).forEach((controller) =>
      controller.abort()
    );
    controllerRef.current = {}; // 清空 ref
  };

  // 失败尝试连接
  const requestRetry = async (url, data, options) => {
    for (let i = 0; i < 5; i++) {
      try {
        return await axios.post(url, data, options);
      } catch (error) {
        if (axios.isCancel(error)) {
          throw error;
        }
        console.error(`切片上传失败，正在进行第 ${i + 1} 次重试...`, error);
        // 如果是最后一次尝试，则抛出错误
        if (i === maxRetries - 1) {
          throw error;
        }
      }
    }
  };
  const handleResume = () => {
    console.log("恢复上传");
    handleUpload();
  };

  const totalProgress = useMemo(() => {
    if (!chunks.length) return 0;
    const loaded = chunks
      .map((c) => c.size * (c.progress / 100))
      .reduce((acc, cur) => acc + cur, 0);

    const total = chunks.reduce((acc, cur) => acc + cur.size, 0);

    return total > 0 ? Math.round((loaded * 100) / total) : 0;
  }, [chunks]);

  return (
    <>
      <div className='app-container'>
        <h1>Node.js + React 大文件上传</h1>
        <div className='progress-container'>
          <h2>Hash 计算进度</h2>
          <progress value={hashProgress} max='100'></progress>
        </div>
        <div className='input-container'>
          <input type='file' onChange={handleFileChange} />
          <button onClick={handleUpload}>上传</button>
          <button onClick={handlePause}>暂停</button>
          <button onClick={handleResume}>恢复</button>
        </div>
        <div className='progress-container'>
          <h2>总进度: {totalProgress}%</h2>
          <progress value={totalProgress} max='100'></progress>
        </div>
        <div className='chunks-container'>
          <h2>切片上传进度</h2>
          <div className='chunks-grid'>
            {chunks.map((chunk) => (
              <div key={chunk.hash} className='chunk-item'>
                <div className='chunk-label'>{chunk.hash.slice(-6)}</div>
                <progress value={chunk.progress} max='100'></progress>
                <span className='chunk-percent'>{chunk.progress}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
