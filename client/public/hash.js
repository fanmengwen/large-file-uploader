// 使用 web worker 计算文件的 MD5 值
// 引入 spark-md5.min.js
self.importScripts("/spark-md5.min.js");

// 计算文件的 MD5 值
self.onmessage = (e) => {
  const { chunks } = e.data;
  const spark = new SparkMD5.ArrayBuffer();
  let progress = 0;
  let count = 0;

  const loadNext = (index) => {
    const reader = new FileReader();

    // 读取文件
    reader.readAsArrayBuffer(chunks[index].fileChunk);

    // 读取完一次
    reader.onload = (e) => {
      count++;
      spark.append(e.target.result);

      if (count === chunks.length) {
        self.postMessage({
          progress: 100,
          hash: spark.end(),
        });
        self.close();
      } else {
        // 更新进度
        progress += 100 / chunks.length;
        self.postMessage({ progress });
        loadNext(count);
      }
    };
  };

  loadNext(0);
};
