# 企业级大文件上传解决方案

## 📋 项目总览

### 项目简介

一个基于 React + Node.js 的企业级大文件上传解决方案，支持文件切片、并发上传、断点续传、秒传等核心功能。解决了传统 HTTP 上传在处理大文件时失败率高、无状态、用户体验差等痛点。

### 🚀 核心功能

- **文件切片上传** - 将大文件分割成小块，降低单次请求失败风险
- **并发请求控制** - 利用 Promise.all 实现并发上传，提升传输效率
- **实时进度监控** - 整体/切片双重进度条，提供精确的上传状态反馈
- **暂停/恢复功能** - 基于 AbortController 实现优雅的暂停与恢复机制
- **断点续传** - 刷新页面或关闭浏览器后依然可续传，提升用户体验
- **文件秒传** - 基于文件 Hash 的智能判断，避免重复上传
- **Web Worker 异步计算** - 文件 Hash 计算不阻塞 UI 线程，保持界面响应性

## 🏗️ 技术实现详解

### 整体架构流程图

1. 用户选择文件
2. 文件切片处理
3. Web Worker 计算 Hash
4. 调用 `/verify` 接口
5. 判断文件是否存在：
   - 是：直接秒传成功
   - 否：检查断点续传
6. 并发上传切片
7. 监听上传进度，循环直到所有切片上传完成
8. 调用 `/merge` 接口
9. 服务端合并文件
10. 清理临时文件
11. 上传完成

### 分阶段技术实现

#### 阶段一：前端预处理 - "准备弹药"

**1. 文件切片 (File.slice)**

```javascript
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
```

**技术要点：**

- `file.slice()` 创建的是 Blob 引用，而非数据复制，内存占用极低
- 默认切片大小：2MB，可根据网络环境动态调整
- 切片操作性能极高，适合处理 GB 级别文件

**2. 文件 Hash 计算 (spark-md5 + Web Worker)**

```javascript
// Web Worker 异步计算，避免阻塞 UI
const worker = new Worker("/hash.js");
worker.postMessage({ chunks });

worker.onmessage = (e) => {
  const { hash, progress } = e.data;
  setHashProgress(progress);
  if (hash) resolve(hash);
};
```

**技术要点：**

- **为什么必须使用 Web Worker？** CPU 密集型任务会阻塞 UI 主线程，导致界面卡顿
- **spark-md5 增量计算**：支持 `append()` 方法，与文件切片完美结合
- **实时进度反馈**：每个切片计算完成后更新进度条

#### 阶段二：握手与校验 (/verify) - "制定作战计划"

**核心职责：** 作为上传策略的"大脑"，决策本次上传类型

```javascript
app.post("/verify", async (req, res) => {
  const { filename, fileHash } = req.body;

  // 1. 检查最终文件目录 - 秒传判断
  const filePath = path.resolve(UPLOAD_DIR, fileHash);
  if (fse.existsSync(filePath)) {
    return res.json({ shouldUpload: false, message: "文件已存在，秒传成功！" });
  }

  // 2. 检查临时切片目录 - 断点续传判断
  const chunkDir = path.resolve(TEMP_CHUNKS_DIR, fileHash);
  if (!fse.existsSync(chunkDir)) {
    return res.json({ shouldUpload: true, uploadedList: [] });
  }

  // 3. 返回已上传切片列表
  const uploadedList = await fse.readdir(chunkDir);
  res.json({ shouldUpload: true, uploadedList });
});
```

**三种上传策略：**

1. **秒传**：文件 Hash 已存在于最终目录
2. **断点续传**：临时目录存在，返回已上传切片列表
3. **全新上传**：临时目录不存在，从头开始上传

#### 阶段三：并发上传与控制 (/upload) - "执行作战"

**1. 并发实现 (Promise.all)**

```javascript
const requests = chunksToUpload
  .filter((chunk) => !uploadedList.includes(chunk.hash))
  .map((chunk) => {
    const controller = new AbortController();
    controllerRef.current[chunk.hash] = controller;

    return axios.post(`${API_URL}/upload`, formData, {
      signal: controller.signal,
      onUploadProgress: (progressEvent) => {
        // 实时更新单个切片进度
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        updateChunkProgress(chunk.hash, percentCompleted);
      },
    });
  });

await Promise.all(requests);
```

**2. 整体进度计算 (加权平均)**

```javascript
const totalProgress = useMemo(() => {
  if (!chunks.length) return 0;

  const loaded = chunks
    .map((c) => c.size * (c.progress / 100))
    .reduce((acc, cur) => acc + cur, 0);

  const total = chunks.reduce((acc, cur) => acc + cur.size, 0);

  return total > 0 ? Math.round((loaded * 100) / total) : 0;
}, [chunks]);
```

**3. 暂停与恢复 (AbortController)**

```javascript
const handlePause = () => {
  Object.values(controllerRef.current).forEach((controller) =>
    controller.abort()
  );
  controllerRef.current = {};
};

const handleResume = () => {
  handleUpload(); // 重新调用上传函数，依赖 /verify 接口自动续传
};
```

**技术要点：**

- **AbortController 中断机制**：优雅地取消在途的 axios 请求
- **恢复的优雅性**：无需额外状态管理，重新调用上传函数即可
- **useMemo 优化**：避免不必要的重复计算，提升性能

#### 阶段四：服务端合并 (/merge) - "打扫战场"

**1. 切片排序的重要性**

```javascript
// 从目录读取的切片列表是无序的，必须严格排序
chunkPaths.sort((a, b) => {
  const indexA = parseInt(a.split("-").pop());
  const indexB = parseInt(b.split("-").pop());
  return indexA - indexB;
});
```

**2. Node.js Streams 的威力**

```javascript
const writeStream = fse.createWriteStream(finalFilePath);
for (const chunkName of chunkPaths) {
  const chunkPath = path.resolve(chunkDir, chunkName);
  const readStream = fse.createReadStream(chunkPath);

  await new Promise((resolve, reject) => {
    readStream.pipe(writeStream, { end: false });
    readStream.on("end", resolve);
    readStream.on("error", reject);
  });
}
writeStream.end();
```

**技术要点：**

- **为什么使用 Stream？** 相比 `fs.readFile` + `fs.appendFile`，Stream 处理大文件时内存占用极低
- **管道机制**：`pipe()` 方法自动处理数据流，无需手动管理缓冲区
- **错误处理**：每个切片合并都有独立的错误处理机制

## 🛠️ 项目部署与使用

### 技术栈

**前端技术栈：**

- **React 19.1.0** - 核心 UI 框架
- **Axios 1.11.0** - HTTP 客户端，支持请求取消和进度监控
- **Spark-MD5 3.0.2** - 快速计算 MD5 哈希，支持增量计算
- **Vite 7.0.4** - 现代化构建工具

**后端技术栈：**

- **Express 5.1.0** - Node.js Web 框架
- **CORS 2.8.5** - 跨域资源共享中间件
- **Multiparty 4.2.3** - multipart/form-data 解析
- **fs-extra 11.3.0** - 增强的文件系统操作
- **Nodemon 3.1.10** - 开发环境自动重启

### 安装与启动

**1. 安装依赖**

```bash
# 安装前端依赖
cd client
npm install

# 安装后端依赖
cd ../server
npm install
```

**2. 启动服务**

```bash
# 启动后端服务 (端口 3000)
cd server
npm run dev

# 启动前端服务 (端口 5173)
cd ../client
npm run dev
```

**4. 访问应用**

- 前端地址：http://localhost:5173
- 后端 API：http://localhost:3000

## 🚀 进阶与展望

### 可优化的点

**1. 并发控制优化**

- **当前方案局限**：`Promise.all` 会同时发起所有请求，可能导致服务器压力过大
- **优化方案**：实现"请求池"机制，控制并发数量

```javascript
// 伪代码示例
const uploadWithConcurrency = async (chunks, maxConcurrency = 3) => {
  const pool = new Array(maxConcurrency).fill(null);
  // 实现并发控制逻辑
};
```

**2. 错误处理与重试**

- **当前不足**：单个切片上传失败后无自动重试机制
- **健壮性方案**：为每个切片增加指数退避重试机制

requestRetry

uploadWithRetry

**3. 定时清理任务**

- **问题**：用户中断上传后，临时切片文件成为"僵尸文件"
- **解决方案**：实现定时任务清理超过 24 小时的临时文件

```javascript
// 定时清理脚本
const cleanupExpiredChunks = () => {
  const expiredTime = Date.now() - 24 * 60 * 60 * 1000;
  // 清理逻辑
};
```

## 📝 总结

本项目实现了一个功能完整的企业级大文件上传解决方案，涵盖了文件切片、并发控制、断点续传、秒传等核心技术。通过 Web Worker 异步计算、Stream 流式处理、AbortController 请求控制等技术手段，确保了良好的用户体验和系统性能。

## 🎯 技术总结

### 前端

- **Web Worker 异步计算**：文件 Hash 计算不阻塞 UI，保持界面响应性
- **AbortController 请求控制**：优雅实现暂停/恢复功能，避免内存泄漏
- **useMemo 性能优化**：避免不必要的重复计算，提升渲染性能
- **实时进度监控**：双重进度条设计，提供精确的上传状态反馈

### 后端

- **Stream 流式处理**：大文件合并时内存占用极低，支持 GB 级别文件
- **智能上传策略**：秒传、断点续传、全新上传三种策略自动判断
- **文件切片管理**：临时文件与最终文件的分离存储，确保数据完整性
- **错误处理机制**：完善的异常处理，提升系统健壮性
