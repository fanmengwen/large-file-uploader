// server/index.js
const express = require("express");
const cors = require("cors");
const multiparty = require("multiparty");
const path = require("path");
const fse = require("fs-extra");
const app = express();

// --- 中间件配置 ---
app.use(cors()); // 允许所有跨域请求
app.use(express.json()); // 解析 application/json 格式的请求体
app.use(express.urlencoded({ extended: true })); // 解析 application/x-www-form-urlencoded 格式的请求体

// --- 静态资源和常量定义 ---
const UPLOAD_DIR = path.resolve(__dirname, "uploads"); // 最终文件存放目录
const TEMP_CHUNKS_DIR = path.resolve(__dirname, "temp_chunks"); // 临时切片存放目录

// --- API 路由 ---
const jsonApiRouter = express.Router();
// 只对这个路由器应用 express.json() 中间件
jsonApiRouter.use(express.json());
jsonApiRouter.use(express.urlencoded({ extended: true }));

// --- 启动服务器 ---
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`服务器正在运行在 http://localhost:${PORT}`);
  // 确保上传目录存在
  fse.ensureDirSync(UPLOAD_DIR);
  fse.ensureDirSync(TEMP_CHUNKS_DIR);
});

app.post("/verify", async (req, res) => {
  const { filename, fileHash } = req.body;

  const filePath = path.resolve(UPLOAD_DIR, fileHash);
  if (fse.existsSync(filePath)) {
    return res.json({
      shouldUpload: false,
      message: "文件已存在，秒传成功！",
    });
  }

  // 2. 检查临时切片目录是否存在，并返回已上传的切片列表 (实现断点续传)
  const chunkDir = path.resolve(TEMP_CHUNKS_DIR, fileHash);

  if (!fse.existsSync(chunkDir)) {
    return res.json({
      //  如果连临时目录都还没有，说明是全新文件
      shouldUpload: true,
      uploadedList: [],
    });
  }
  try {
    const uploadedList = await fse.readdir(chunkDir);
    res.json({
      shouldUpload: true,
      uploadedList: uploadedList,
    });
  } catch {
    res.status(500).json({ error: "读取切片目录失败" });
  }
});

app.post("/upload", async (req, res) => {
  const form = new multiparty.Form();
  form.parse(req, async (error, fields, files) => {
    console.log("🦄  file: index.js:63  files:", files);

    if (error) {
      console.error("解析 form-data 失败:", error);
      return res.status(500).json({ error: "文件上传失败" });
    }

    try {
      const [chunk] = files.chunk; // 上传的文件切片
      const [hash] = fields.hash; // 整个文件的 hash
      const [chunkHash] = fields.chunkHash; // 当前切片的 hash (或者叫 identifier)

      const chunkDir = path.resolve(TEMP_CHUNKS_DIR, hash);
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }
      const chunPath = path.resolve(chunkDir, chunkHash);
      await fse.move(chunk.path, chunPath, { overwrite: true });
      res.status(200).send("切片上传成功");
    } catch {}
  });
});
