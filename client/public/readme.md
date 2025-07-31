worker.postMessage({ chunks }): 主线程向 Worker 线程发送数据。注意，这里发送的数据会被结构化克隆算法复制一份，而不是共享内存（除非使用 Transferable Objects，但这里不需要）。

worker.onmessage: 监听从 Worker 线程返回的消息。

self.onmessage (Worker 内部): Worker 监听从主线程发来的消息。self 在 Worker 作用域中指向 Worker 本身。

self.importScripts('/spark-md5.min.js'): Worker 加载外部脚本的方式。

## 流程

Worker 开始执行，读到 self.importScripts("/spark-md5.min.js"); 这一行。

它会暂停执行，立即去下载 /spark-md5.min.js 这个文件。

下载完成后，它会立刻执行这个 JS 文件。我们从 node_modules 复制过来的 spark-md5.min.js 是一个 UMD 格式的文件，它执行后会向全局作用域（在 Worker 中就是 self）挂载一个名为 SparkMD5 的变量。

importScripts 执行完毕后，Worker 继续执行后续代码。此时，SparkMD5 已经成为了 self 的一个属性，所以在后续代码中就可以直接通过 self.SparkMD5 或 SparkMD5 来使用了。
