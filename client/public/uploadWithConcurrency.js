/**
 * 模拟一个上传切片的函数，它会随机消耗 1-3 秒
 * @param {object} chunk - 要上传的切片对象
 * @returns {Promise<void>}
 */
const uploadChunk = (chunk) => {
  return new Promise((resolve) => {
    const delay = Math.random() * 2000 + 1000; // 模拟 1-3 秒的上传时间
    setTimeout(() => {
      resolve();
    }, delay);
  });
};

/**
 * 并发控制上传函数
 * @param {Array<object>} chunks - 所有待上传的切片数组
 * @param {number} maxConcurrency - 最大并发数
 */
const uploadWithConcurrency = async (chunks, maxConcurrency = 5) => {
  const tasks = [...chunks];

  const workers = [];
  const worker = async (i) => {
    while (tasks.length > 0) {
      const chunk = tasks.shift();
      console.log("🦄  file: uploadWithConcurrency.js:27  chunk: ", chunk, i);
      await uploadChunk(chunk);
    }
  };

  for (let i = 0; i < maxConcurrency; i++) {
    workers.push(worker(i)); // 安排了 5 个工人
  }

  await Promise.all(workers);
};

// --- 使用示例 ---
const main = async () => {
  // 创建 10 个模拟的切片任务
  const allChunks = Array.from({ length: 10 }, (_, i) => ({
    name: `chunk-${i + 1}`,
  }));

  await uploadWithConcurrency(allChunks, 3);
};

main();
