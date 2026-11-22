-- 老師可逐班開啟／關閉認證模式（預設關閉）
ALTER TABLE classes ADD COLUMN cert_open INTEGER NOT NULL DEFAULT 0;
