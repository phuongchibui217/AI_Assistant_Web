# AI Virtual Assistant - Web Application (Frontend & Admin)

Đồ án tốt nghiệp ngành Hệ thống Thông tin Quản lý (MIS) - Trường Đại học Kinh tế, ĐH Đà Nẵng (DUE).
Hệ thống Trợ lý ảo AI đa năng tích hợp RAG (Retrieval-Augmented Generation) và nhân vật ảo 2D tương tác thời gian thực.

## Giới thiệu hệ thống (Architecture)

Hệ thống bao gồm hai phân hệ chính chạy trên cùng nền tảng Next.js:
1. **Web Client (`/`)**: Giao diện người dùng cuối tương tác trực tiếp với Trợ lý ảo AI:
   - Mô hình nhân vật ảo 2D (Three.js) hỗ trợ nhép miệng thời gian thực (Lip-sync), chớp mắt và cử động tự nhiên.
   - Giao tiếp đa phương thức: Giọng nói hai chiều (Speech-to-Text / Text-to-Speech) và khung chat văn bản.
   - Hỗ trợ đa ngôn ngữ: Tiếng Việt (VI), Tiếng Anh (EN), Tiếng Nhật (JP), Tiếng Trung phồn thể (TW).
2. **Admin Portal (`/admin`)**: Bảng điều khiển quản trị toàn diện:
   - Dashboard: Giám sát trạng thái hệ thống, phiên trò chuyện, tài liệu tri thức và phân đoạn RAG.
   - Quản lý Trợ lý ảo (Assistants): Cấu hình danh tính, phong cách giao tiếp và prompt chỉ dẫn.
   - Kho tri thức (Knowledge Base): Quản lý tệp tài liệu, phân đoạn chunk và vector embedding.
   - Lịch sử trò chuyện (Chat History): Nhật ký hội thoại và kiểm tra độ chính xác của câu trả lời AI.
   - Cài đặt hệ thống (Settings): Cấu hình hiển thị avatar, âm thanh giọng nói và bảo mật.

## Công nghệ sử dụng (Tech Stack)

- **Framework**: Next.js 14 (App Router) + React 18
- **Language & Styling**: TypeScript, Tailwind CSS, Lucide Icons
- **Computer Graphics**: Three.js (2D Sprite-stacked Talking Avatar Animation)
- **AI & Speech**: Gemini Live WebSocket Proxy, Google Cloud STT & TTS, RAG Pipeline
- **Server**: Node.js custom server (`server.js`) hỗ trợ proxy WebSocket bảo mật

## Hướng dẫn cài đặt và chạy thử nghiệm (Local Development)

```bash
# 1. Cài đặt các thư viện phụ thuộc
npm install

# 2. Tạo tệp cấu hình môi trường từ mẫu
copy .env.local.example .env.local

# 3. Khởi chạy máy chủ phát triển
npm run dev
```

Sau khi khởi chạy thành công, truy cập hệ thống tại:
- **Giao diện Trợ lý ảo (Client)**: `http://127.0.0.1:3001`
- **Giao diện Quản trị viên (Admin)**: `http://127.0.0.1:3001/admin`
