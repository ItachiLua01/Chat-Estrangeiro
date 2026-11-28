import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { filename, dataUrl } = req.body || {};
    if (!filename || !dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "Arquivo inválido" });
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Formato base64 inválido" });
    }

    const buffer = Buffer.from(match[2], "base64");
    const safeName = `${Date.now()}-${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, safeName), buffer);

    return res.status(200).json({ url: `/uploads/${safeName}` });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao salvar arquivo" });
  }
}
