worker.postMessage({ chunks }): 主线程向 Worker 线程发送数据。注意，这里发送的数据会被结构化克隆算法复制一份，而不是共享内存（除非使用 Transferable Objects，但这里不需要）。

worker.onmessage: 监听从 Worker 线程返回的消息。

self.onmessage (Worker 内部): Worker 监听从主线程发来的消息。self 在 Worker 作用域中指向 Worker 本身。

self.importScripts('/spark-md5.min.js'): Worker 加载外部脚本的方式。
