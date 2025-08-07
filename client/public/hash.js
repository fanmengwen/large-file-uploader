// 使用 web worker 计算文件的 MD5 值

// 引入 spark-md5.min.js
// 因为 new Worker('some-script.js') 创建一个 Worker 时，
// 浏览器会加载并执行 some-script.js 这个文件，但它是在一个全新的、与主页面完全隔离的后台线程中运行
self.importScripts("/spark-md5.min.js");

// 计算文件的 MD5 值， 监听来自主线程的消息
// self ≈ globalThis（全局作用域）
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
