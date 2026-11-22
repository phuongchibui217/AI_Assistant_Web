"use client";

import React, { useState, useEffect, useRef } from "react";
import { KbFilePreview, kbOriginalUrl, kbSourceLink } from "@/components/kb-file-preview";
import { backgroundImageMediaType, BACKGROUND_IMAGE_ACCEPT, MAX_BACKGROUND_IMAGE_BYTES } from "@/lib/backgrounds";
import { listenForLogout, logout } from "@/lib/client-auth";
import { formatKbFileSize, kbPreviewKind, KB_STORAGE_QUOTA_BYTES } from "@/lib/kb-file";
import type { DemoFile as FileItem } from "@/lib/server/demo-store";
import {
  LayoutDashboard,
  Settings,
  Bot,
  Sliders,
  Database,
  BookA,
  History,
  Image as ImageIcon,
  LogOut,
  Upload,
  Search,
  FileText,
  Trash2,
  Eye,
  CheckCircle2,
  Layers,
  MessageSquare,
  Shield,
  X,
  RefreshCw,
  Plus,
  ScanText,
  Key,
  Globe,
  AlertCircle,
  Folder,
  FolderPlus,
  Check,
  ChevronRight,
  ChevronDown,
  Filter,
  CheckCircle,
} from "lucide-react";

export type Lang = "vi" | "en" | "ja" | "zh";
export type Tab =
  | "dashboard"
  | "assistants"
  | "stances"
  | "knowledge-base"
  | "lexemes"
  | "chat-history"
  | "backgrounds"
  | "settings";

interface AssistantItem {
  id: number;
  name: Record<Lang, string>;
  version: string;
  state: number; // 1: Active, 0: Inactive
  persona: string;
}

interface StanceItem {
  id: number;
  assistantId: number;
  name: Record<Lang, string> | string;
  version: string;
  tone: Record<Lang, string> | string;
  attitude: Record<Lang, string> | string;
  lexicon: Record<Lang, string> | string;
  precision: Record<Lang, string> | string;
  boundaries: Record<Lang, string> | string;
  state: number; // 1: Active, 0: Inactive
}

const stanceFieldClassName = "flex min-w-0 flex-col justify-end gap-1 text-sm font-semibold leading-[1.125rem] text-slate-700";
const stanceControlBaseClassName = "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-base font-normal text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:px-3 sm:text-sm";
const stanceControlClassName = `${stanceControlBaseClassName} h-9 sm:h-10 [@media(max-height:520px)]:h-8`;
const stanceSelectClassName = `${stanceControlClassName} appearance-none pr-7 sm:pr-8 cursor-pointer`;
const stanceTextareaClassName = `${stanceControlBaseClassName} resize-y py-2`;

const settingsSectionTitleClassName = "text-xl font-semibold leading-7 tracking-tight";
const settingsDescriptionClassName = "text-sm leading-5 text-slate-600";
const settingsControlClassName = "block h-10 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-base font-normal leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500";
const settingsCardClassName = "min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs sm:px-6";

interface LexemeItem {
  id: number;
  grapheme: string;
  type: "Phoneme" | "Alias";
  phoneme: string;
  state: number; // 1: Active, 0: Inactive
}

interface ChatRecordItem {
  id: number;
  sessionId: string;
  source: string;
  question: string;
  answer: string;
  questionAt: string;
  answerAt: string;
  deleted?: boolean;
}

interface BackgroundItem {
  id: number;
  name: string;
  filename: string;
  url: string;
  active: boolean;
}

const t = {
  vi: {
    brand: "AI Virtual Assistant System",
    subBrand: "Bảng quản trị",
    admin: "Quản trị viên",
    logout: "Đăng xuất",

    // Tabs
    tabDashboard: "Bảng điều khiển",
    tabSettings: "Cài đặt hệ thống",
    tabAssistants: "Trợ lý ảo",
    tabStances: "Phong cách",
    tabKnowledgeBase: "Kho tri thức",
    tabLexemes: "Từ điển phát âm",
    tabChatHistory: "Lịch sử trò chuyện",
    tabBackgrounds: "Hình nền giao diện",

    // Dashboard
    dashboardTitle: "Bảng điều khiển",
    welcome: "Chào mừng trở lại, Quản trị viên",
    assistants: "Trợ lý ảo",
    chatSessions: "Phiên hội thoại",
    kbDocuments: "Tài liệu Kho tri thức",
    ragChunks: "Phân đoạn RAG",
    activeAssistants: "Trợ lý đang hoạt động",
    totalConversations: "Tổng số cuộc hội thoại",
    uploadedFiles: "Tệp tin đã tải lên",
    vectorPoints: "Điểm vector trong Qdrant",
    recentActivity: "Hoạt động gần đây",
    quickStats: "Trạng thái hệ thống",

    // Assistants
    assistantsTitle: "Danh sách Trợ lý ảo",
    assistantsSubtitle: "Quản lý danh tính, phong cách và chỉ dẫn nhân vật",
    newAssistant: "Tạo trợ lý mới",
    thId: "Mã số",
    thName: "Tên trợ lý",
    thVersion: "Phiên bản",
    thState: "Trạng thái",
    thActions: "Thao tác",
    btnEdit: "Chỉnh sửa",
    btnStances: "Phong cách",
    btnDelete: "Xóa",
    badgeActive: "Đang hoạt động",
    badgeInactive: "Tạm dừng",
    assistantNameLabel: "Tên trợ lý",
    versionLabel: "Phiên bản",
    stateLabel: "Trạng thái",
    personaJsonLabel: "Cấu hình nhân vật (JSON)",
    btnSave: "Lưu thay đổi",
    btnCreate: "Tạo mới",
    btnUpdate: "Cập nhật",
    btnCancel: "Hủy bỏ",
    btnConfirm: "Xác nhận",
    emptyAssistants: "Chưa có trợ lý nào",
    confirmDeleteAssistantTitle: "Xác nhận xóa Trợ lý",
    confirmDeleteAssistantMsg: "Bạn có chắc chắn muốn xóa hồ sơ trợ lý này không? Thao tác này sẽ thực hiện xóa mềm để duy trì tính toàn vẹn dữ liệu.",
    alertReqFields: "Vui lòng điền đầy đủ các trường bắt buộc",
    alertDuplicateAssistant: "Tên và phiên bản trợ lý đã tồn tại",
    alertInvalidJson: "Định dạng JSON không hợp lệ",
    alertAssistantCreated: "Tạo trợ lý thành công",
    alertAssistantUpdated: "Cập nhật trợ lý thành công",
    alertAssistantDeleted: "Xóa trợ lý thành công",

    // Knowledge Base
    kbTitle: "Kho tài liệu tri thức",
    kbSubtitle: "Google Cloud Storage - knowledge-base",
    quotaUsagePrefix: "Dung lượng đã dùng: ",
    allFolders: "Tất cả thư mục",
    filesTotalSuffix: "tệp tin",
    showingRange: "Hiển thị {0}–{1} / {2}",
    tabKbFiles: "Danh sách tài liệu",
    tabKbOcr: "Tải lên OCR",
    uploadUrl: "Tải lên URL",
    uploadFile: "Tải tệp lên",
    btnUpload: "Tải lên",
    searchPlaceholder: "Tìm kiếm tài liệu theo tên...",
    thFileName: "Tên",
    thFileSize: "Dung lượng",
    thStatus: "Trạng thái",
    thFolder: "Thư mục",
    thUpdated: "Chỉnh sửa",
    statusDone: "Hoàn tất",
    statusPending: "Đang chờ",
    statusProcessing: "Đang xử lý",
    statusFailed: "Thất bại",
    statusNotIndexed: "Chưa lập chỉ mục",
    btnPreview: "Xem trước",
    btnDownload: "Tải xuống",
    btnReprocess: "Xử lý lại",
    emptyFiles: "Không có tệp tin nào",
    noMatchFiles: "Không tìm thấy tệp phù hợp với từ khóa tìm kiếm",
    uploadFileModalTitle: "Tải tệp tin lên Kho tri thức",
    chooseFiles: "Chọn tệp từ máy tính",
    dragDropHint: "hoặc kéo thả tệp vào đây (PDF, DOCX, XLSX, HTML, TXT, MD, tệp ảnh)",
    targetFolder: "Thư mục đích",
    rootFolder: "Thư mục gốc (root)",
    customFolderPlaceholder: "Hoặc nhập tên thư mục mới...",
    alertSelectFile: "Vui lòng chọn ít nhất một tệp để tải lên",
    alertUnsupportedFormat: "Định dạng tệp không được hỗ trợ. Vui lòng tải lên PDF, DOCX, XLSX, HTML, TXT, MD hoặc tệp ảnh",
    alertStorageQuota: "Vượt quá dung lượng lưu trữ 1.0 GB. Vui lòng xóa bớt tệp hoặc nâng cấp dung lượng",
    alertUploadSuccess: "Tải tệp lên thành công",
    uploadUrlModalTitle: "Nhập tài liệu từ liên kết",
    sourceUrl: "Địa chỉ liên kết",
    saveAsFilename: "Tên tệp lưu lại (tùy chọn)",
    btnFetchUpload: "Thu thập & Tải lên",
    alertEnterUrl: "Vui lòng nhập URL hợp lệ",
    alertInvalidUrl: "Định dạng URL không hợp lệ. Vui lòng nhập URL HTTP/HTTPS",
    alertImportSuccess: "Nhập tài liệu thành công",
    previewModalTitle: "Xem trước tài liệu",
    btnOpenLink: "Mở liên kết",
    confirmDeleteFileTitle: "Xác nhận xóa tệp tin",
    confirmDeleteFileMsg: "Hành động này không thể hoàn tác. Tệp sẽ bị xóa vĩnh viễn khỏi lưu trữ đám mây và toàn bộ vector nhúng sẽ bị xóa khỏi cơ sở dữ liệu.",
    alertFileDeleted: "Xóa tệp tin thành công",
    alertReprocessQueued: "Đã đưa tài liệu vào hàng đợi xử lý lại vector",

    // OCR Upload
    ocrTitle: "Trích xuất văn bản & Lập chỉ mục OCR",
    ocrSubtitle: "Trích xuất nội dung văn bản từ tài liệu quét hoặc ảnh chụp, xem lại và chỉnh sửa trước khi đồng bộ vector",
    ocrSelectFile: "Chọn tệp",
    ocrSelectFilesBtn: "Chọn tệp",
    targetKbFolder: "Đường dẫn thư mục đích",
    autoIndexQdrant: "Tự động lập chỉ mục vào kho vector",
    btnRunOcr: "Chạy trích xuất OCR",
    btnSaveToKb: "Lưu vào Kho tri thức",
    ocrStatusReady: "Sẵn sàng trích xuất",
    ocrStatusRunning: "Đang nhận dạng văn bản...",
    ocrStatusDone: "Trích xuất hoàn tất - Bạn có thể xem lại và chỉnh sửa bên dưới:",
    alertOcrSuccess: "Lưu và lập chỉ mục nội dung thành công!",
    alertOcrSavedNoIndex: "Đã lưu nội dung OCR vào Kho tri thức (chưa lập chỉ mục RAG)",
    alertOcrUnsupportedFormat: "Định dạng tệp không được hỗ trợ. Vui lòng tải lên tệp ảnh, PDF, HTML hoặc văn bản thuần túy",
    alertEmptyOcr: "Nội dung văn bản trích xuất không được để trống",

    // Stances
    stancesTitle: "Phong cách giao tiếp",
    stancesSubtitle: "Cấu hình ngữ điệu, thái độ, nhịp điệu và ranh giới phản hồi",
    newStance: "Thêm phong cách mới",
    filterByAssistant: "Lọc theo Trợ lý:",
    allAssistants: "Tất cả trợ lý",
    lblAssistant: "Trợ lý",
    thAssistant: "Trợ lý",
    thStanceId: "Mã phong cách",
    thStanceName: "Tên phong cách",
    btnView: "Xem",
    lblStanceName: "Tên phong cách",
    lblVersion: "Phiên bản",
    lblTone: "Ngữ điệu",
    lblAttitude: "Thái độ",
    lblLexicon: "Từ vựng & Nhịp điệu",
    lblPrecision: "Độ chính xác & Ngắn gọn",
    lblBoundaries: "Ranh giới & Quy tắc",
    emptyStances: "Chưa có phong cách nào",
    createStanceTitle: "Tạo phong cách giao tiếp mới",
    alertStanceCreated: "Tạo phong cách thành công",
    alertStanceUpdated: "Cập nhật phong cách thành công",
    alertStanceStatus: "Cập nhật trạng thái phong cách thành công",

    // Lexemes
    lexemesTitle: "Từ điển phát âm",
    lexemesSubtitle: "Tùy chỉnh phiên âm và từ thay thế cho giọng đọc TTS",
    newLexeme: "Thêm từ vựng mới",
    thGrapheme: "Từ gốc",
    thType: "Loại",
    thReading: "Phiên âm / Chuẩn hóa",
    thActive: "Kích hoạt",
    lblGrapheme: "Từ gốc",
    lblType: "Loại từ vựng",
    lblReading: "Phiên âm đọc hoặc Từ thay thế",
    optPhoneme: "Phát âm giọng đọc",
    optAlias: "Từ viết tắt / Đồng nghĩa",
    createLexemeTitle: "Thêm từ vựng phát âm mới",
    editLexemeTitle: "Chỉnh sửa từ vựng phát âm",
    emptyLexemes: "Chưa có từ vựng nào",
    confirmDeleteLexemeTitle: "Xác nhận xóa",
    confirmDeleteLexemeMsg: "Xóa từ vựng ‘{0}’? Hành động này không thể hoàn tác.",
    alertLexemeCreated: "Tạo từ vựng thành công",
    alertLexemeUpdated: "Cập nhật từ vựng thành công",
    alertLexemeDeleted: "Xóa từ vựng thành công",
    alertLexemeStatus: "Cập nhật trạng thái từ vựng thành công",
    alertDuplicateLexeme: "Từ gốc này đã tồn tại trong từ điển",

    // Chat History
    chatHistoryTitle: "Lịch sử trò chuyện",
    chatHistorySubtitle: "Kiểm tra nhật ký hội thoại theo phiên, câu hỏi người dùng và câu trả lời của AI",
    thSession: "Phiên",
    thSource: "Nguồn",
    thQuestion: "Câu hỏi",
    thQuestionTime: "Thời gian hỏi",
    btnViewDetails: "Xem chi tiết",
    lblQuestion: "Câu hỏi của người dùng",
    lblAnswer: "Câu trả lời của AI",
    lblQuestionAt: "Thời điểm hỏi",
    lblAnswerAt: "Thời điểm trả lời",
    chatDetailTitle: "Chi tiết lượt hội thoại",
    chatId: "Mã hội thoại",
    sessionId: "Mã phiên",
    emptyChatHistory: "Chưa có lịch sử trò chuyện nào",
    confirmDeleteChatTitle: "Xác nhận xóa bản ghi hội thoại",
    confirmDeleteChatMsg: "Xóa mềm bản ghi hội thoại này. Bản ghi sẽ bị ẩn khỏi danh sách.",
    alertChatDeleted: "Đã xóa mềm bản ghi hội thoại thành công",
    sessionTurnsTitle: "Các lượt hội thoại trong phiên:",
    turnsUnit: "lượt",

    // Backgrounds
    backgroundsTitle: "Hình nền giao diện",
    backgroundsSubtitle: "Tải lên, xóa và chọn hình nền hiển thị trên giao diện người dùng. PNG / JPEG / WebP, tối đa 10 MB.",
    uploadImage: "Tải ảnh lên",
    uploadingImage: "Đang tải ảnh…",
    btnSetActive: "Đặt làm hình nền",
    badgeCurrentActive: "Đang áp dụng",
    emptyBackgrounds: "Chưa có hình nền nào",
    confirmDeleteBgTitle: "Xác nhận xóa hình nền",
    confirmDeleteBgMsg: "Xóa hình nền này? Giao diện người dùng sẽ ngừng hiển thị hình nền.",
    alertImageSuccess: "Tải ảnh nền lên thành công",
    alertImageFormat: "Định dạng hình ảnh không được hỗ trợ. Vui lòng tải PNG, JPEG hoặc WebP",
    alertImageSize: "Kích thước hình ảnh không được vượt quá 10 MB",
    alertImageUploadFailed: "Không thể tải ảnh lên. Vui lòng thử lại.",
    alertBgDeleted: "Đã xóa hình nền thành công",
    alertBgDeleteFailed: "Không thể xóa ảnh. Vui lòng thử lại.",
    alertBgActiveUpdated: "Đã chuyển đổi hình nền kích hoạt",
    alertBgUpdateFailed: "Không thể đổi hình nền. Vui lòng thử lại.",
    bgDefault: "Không gian Văn phòng Doanh nghiệp (Mặc định)",
    bgHall: "Hội trường Hội nghị Quốc tế",

    // Settings
    settingsTitle: "Cài đặt hệ thống",
    settingsSubtitle: "Cấu hình hành vi giao diện người dùng, tùy chọn ngôn ngữ và mật khẩu bảo mật",
    clientBehaviorSection: "Hành vi giao diện người dùng",
    lockToggle: "Khóa cài đặt phía người dùng",
    lockDesc: "Ngăn ứng dụng Unity ghi đè cài đặt",
    avatarToggle: "Bật nhân vật ảo",
    avatarDesc: "Hiển thị nhân vật trợ lý 3D/2D",
    voiceToggle: "Bật giọng nói",
    voiceDesc: "Đọc câu trả lời bằng giọng nói",
    authToggle: "Đăng nhập Web Client",
    authDesc: "Yêu cầu khách đăng nhập trước khi sử dụng Web Client. Khi tắt, ai có đường dẫn cũng có thể truy cập.",
    defaultLangSection: "Tùy chọn ngôn ngữ mặc định",
    defaultUiLang: "Ngôn ngữ giao diện mặc định",
    defaultUiLangDesc: "Ngôn ngữ Web Client hiển thị khi khách truy cập lần đầu. Sau đó, hệ thống ghi nhớ lựa chọn của họ.",
    defaultMicLang: "Ngôn ngữ nhận diện giọng nói mặc định",
    defaultMicLangDesc: "Ngôn ngữ nhập bằng giọng nói được chọn sẵn trên Web Client. Chế độ Theo ngôn ngữ giao diện giúp hai ngôn ngữ luôn đồng bộ. Chế độ Tự động nhận diện ngôn ngữ nhưng không hiển thị văn bản tạm thời trong lúc nói.",
    defaultTranslateA: "Ngôn ngữ dịch nguồn mặc định",
    defaultTranslateDesc: "Cặp ngôn ngữ dùng khi bắt đầu chế độ phiên dịch. Chỉ áp dụng đến khi khách tự chọn cặp ngôn ngữ.",
    clientPasswordSection: "Mật khẩu người dùng (Web Client)",
    clientPasswordDesc: "Đặt mật khẩu để người dùng truy cập Web Client.",
    clientPasswordMissing: "Chưa đặt mật khẩu.",
    clientPasswordMissingOpen: "Chưa đặt mật khẩu. Người dùng hiện có thể truy cập Web Client tự do.",
    clientPasswordConfigured: "Đã đặt mật khẩu.",
    clientUsernameLabel: "Tên người dùng",
    newPasswordLabel: "Mật khẩu mới",
    newPasswordPlaceholder: "Nhập mật khẩu mới",
    btnManageClientPassword: "Mật khẩu người dùng",
    btnSetPassword: "Đặt mật khẩu",
    btnSaveSettings: "Lưu cài đặt",
    alertPasswordUpdated: "Cập nhật mật khẩu thành công!",
    alertPasswordUpdateFailed: "Không thể cập nhật mật khẩu. Vui lòng thử lại.",
    alertSettingsSaved: "Đã lưu cài đặt hệ thống thành công!",
    alertLogoutFailed: "Đăng xuất thất bại. Vui lòng thử lại.",
    chooseFileBtn: "Chọn tệp",
    noFileChosen: "Chưa chọn tệp nào",
    selectedFilesLabel: "Đã chọn",
    uploadingFile: "Đang tải lên…",
    alertUploadFailed: "Không thể tải tệp lên. Vui lòng thử lại.",
    previewLoading: "Đang mở tài liệu…",
    previewMissing: "Không tìm thấy tệp gốc. Hãy tải lại tệp để xem nội dung.",
    previewFailed: "Không thể hiển thị tài liệu này.",
    previewEmpty: "Trang tính này chưa có dữ liệu.",
    langJa: "Tiếng Nhật (ja)",
    langEn: "Tiếng Anh (en)",
    langVi: "Tiếng Việt (vi)",
    langZh: "Tiếng Trung (zh)",
    phAssistantName: "VD: Trợ lý ảo Doanh nghiệp",
    phFilename: "huong_dan_cong_ty.html",
    phStanceName: "VD: Phong cách chuẩn mực",
    phTone: "VD: Lịch thiệp, trang trọng",
    phAttitude: "VD: Tận tình và chuyên nghiệp",
    phLexicon: "VD: Thuật ngữ chuẩn doanh nghiệp",
    phPrecision: "VD: Ngắn gọn, chính xác theo tài liệu",
    phBoundaries: "VD: Chỉ trả lời từ tài liệu đã xác minh",
    phGrapheme: "VD: AIMind",
    phReading: "VD: A-I Mind Technology",
    typePhoneme: "Phát âm",
    typeAlias: "Từ thay thế",
    micLangEn: "Tiếng Anh (en-US)",
    micLangVi: "Tiếng Việt (vi-VN)",
    micLangJa: "Tiếng Nhật (ja-JP)",
    micLangZh: "Tiếng Trung (zh-CN)",
    defaultTone: "Lịch thiệp & trang trọng",
    defaultAttitude: "Tận tình hỗ trợ",
    defaultLexicon: "Nhịp điệu chuẩn mực",
    defaultPrecision: "Chính xác & ngắn gọn",
    defaultBoundaries: "Chỉ dựa trên dữ liệu trong kho tri thức",
    uploadedUrlSampleContent: "Tài liệu thu thập từ liên kết {0}. Đã tiền xử lý và lập chỉ mục cho truy vấn ngữ cảnh RAG.",
    ocrSampleResult: "[Kết quả OCR - {0}]\nCông ty Cổ phần AI Mind Technology - Quyết định số 0402346569/QĐ-AIMIND\nĐiều 1: Quy định nội bộ về sử dụng mô hình AI tạo sinh, nhúng vector và bảo mật kho tri thức doanh nghiệp.\nĐiều 2: Toàn bộ nhân sự tương tác với trợ lý ảo AI phải tuân thủ nghiêm ngặt quy trình an toàn thông tin.",
  },
  en: {
    brand: "AI Virtual Assistant System",
    subBrand: "Admin Panel",
    admin: "Admin",
    logout: "Logout",

    // Tabs
    tabDashboard: "Dashboard",
    tabSettings: "Settings",
    tabAssistants: "Assistants",
    tabStances: "Stances",
    tabKnowledgeBase: "Knowledge Base",
    tabLexemes: "Lexemes",
    tabChatHistory: "Chat History",
    tabBackgrounds: "Backgrounds",

    // Dashboard
    dashboardTitle: "Dashboard",
    welcome: "Welcome back, Admin",
    assistants: "Assistants",
    chatSessions: "Chat Sessions",
    kbDocuments: "KB Documents",
    ragChunks: "RAG Chunks",
    activeAssistants: "Active assistants",
    totalConversations: "Total conversations",
    uploadedFiles: "Uploaded files",
    vectorPoints: "Qdrant vector points",
    recentActivity: "Recent Activity",
    quickStats: "System Health",

    // Assistants
    assistantsTitle: "Assistants",
    assistantsSubtitle: "Manage assistant personas and instruction prompts",
    newAssistant: "New Assistant",
    thId: "ID",
    thName: "Name",
    thVersion: "Version",
    thState: "State",
    thActions: "Actions",
    btnEdit: "Edit",
    btnStances: "Stances",
    btnDelete: "Delete",
    badgeActive: "Active",
    badgeInactive: "Inactive",
    assistantNameLabel: "Assistant Name",
    versionLabel: "Version",
    stateLabel: "State",
    personaJsonLabel: "Persona Configuration (JSON)",
    btnSave: "Save Changes",
    btnCreate: "Create",
    btnUpdate: "Update",
    btnCancel: "Cancel",
    btnConfirm: "Confirm",
    emptyAssistants: "No assistants exist",
    confirmDeleteAssistantTitle: "Confirm Delete Assistant",
    confirmDeleteAssistantMsg: "Are you sure you want to delete this assistant profile? This will perform a soft-delete to maintain historical integrity.",
    alertReqFields: "Please fill in all required fields",
    alertDuplicateAssistant: "Assistant name and version combination already exists",
    alertInvalidJson: "Invalid JSON format",
    alertAssistantCreated: "Assistant created successfully",
    alertAssistantUpdated: "Assistant updated successfully",
    alertAssistantDeleted: "Assistant deleted successfully",

    // Knowledge Base
    kbTitle: "Knowledge Base",
    kbSubtitle: "Google Cloud Storage - knowledge-base",
    quotaUsagePrefix: "Storage used: ",
    allFolders: "All folders",
    filesTotalSuffix: "file(s) total",
    showingRange: "Showing {0}–{1} of {2}",
    tabKbFiles: "Document Files",
    tabKbOcr: "OCR Upload",
    uploadUrl: "Upload URL",
    uploadFile: "Upload File",
    btnUpload: "Upload",
    searchPlaceholder: "Search files by name...",
    thFileName: "Name",
    thFileSize: "Size",
    thStatus: "Status",
    thFolder: "Folder",
    thUpdated: "Modified",
    statusDone: "Done",
    statusPending: "Pending",
    statusProcessing: "Processing",
    statusFailed: "Failed",
    statusNotIndexed: "Not Indexed",
    btnPreview: "Preview",
    btnDownload: "Download",
    btnReprocess: "Reprocess",
    emptyFiles: "No files exist",
    noMatchFiles: "No files match your search",
    uploadFileModalTitle: "Upload Files",
    chooseFiles: "Choose files from computer",
    dragDropHint: "or drag and drop files here (PDF, DOCX, XLSX, HTML, TXT, MD, image files)",
    targetFolder: "Target Folder",
    rootFolder: "root (Default root)",
    customFolderPlaceholder: "Or enter custom folder path...",
    alertSelectFile: "Please select at least one file to upload",
    alertUnsupportedFormat: "Unsupported file format. Please upload PDF, DOCX, XLSX, HTML, TXT, MD, or image files",
    alertStorageQuota: "Storage quota exceeded (1.0 GB limit). Please delete unused files or upgrade storage",
    alertUploadSuccess: "File uploaded successfully",
    uploadUrlModalTitle: "Upload from URL",
    sourceUrl: "Source URL",
    saveAsFilename: "Save as filename (optional)",
    btnFetchUpload: "Fetch & Upload",
    alertEnterUrl: "Please enter a valid URL",
    alertInvalidUrl: "Invalid URL format. Please enter a valid HTTP/HTTPS URL",
    alertImportSuccess: "Document imported successfully",
    previewModalTitle: "Preview Document",
    btnOpenLink: "Open link",
    confirmDeleteFileTitle: "Confirm Delete File",
    confirmDeleteFileMsg: "This action cannot be undone. The raw document will be permanently purged from storage and corresponding vectors purged from Qdrant.",
    alertFileDeleted: "File deleted successfully",
    alertReprocessQueued: "Document reprocessing task queued",

    // OCR Upload
    ocrTitle: "OCR Document Text Extraction",
    ocrSubtitle: "Extract textual passages from images or scanned PDFs, review and edit before indexing into Qdrant",
    ocrSelectFile: "Select Files",
    ocrSelectFilesBtn: "Select Files",
    targetKbFolder: "Target KB Folder Path",
    autoIndexQdrant: "Auto-index into RAG (Qdrant)",
    btnRunOcr: "Run OCR",
    btnSaveToKb: "Save to KB",
    ocrStatusReady: "Ready for OCR extraction",
    ocrStatusRunning: "Extracting text with Gemini Vision OCR...",
    ocrStatusDone: "OCR Extraction Done - Review and modify below:",
    alertOcrSuccess: "OCR content saved and indexed successfully!",
    alertOcrSavedNoIndex: "OCR content saved to Knowledge Base (not indexed into RAG)",
    alertOcrUnsupportedFormat: "Unsupported file format. Please upload an image, PDF, HTML, or plain text file",
    alertEmptyOcr: "Extracted text cannot be empty",

    // Stances
    stancesTitle: "Stances",
    stancesSubtitle: "Configure tone, rhythm, attitude, and response boundaries",
    newStance: "New Stance",
    filterByAssistant: "Filter by Assistant:",
    allAssistants: "All Assistants",
    lblAssistant: "Associated Assistant",
    thAssistant: "Assistant",
    thStanceId: "Stance ID",
    thStanceName: "Name",
    btnView: "View",
    lblStanceName: "Stance Name",
    lblVersion: "Version",
    lblTone: "Tone",
    lblAttitude: "Attitude",
    lblLexicon: "Lexicon & Rhythm",
    lblPrecision: "Precision & Brevity",
    lblBoundaries: "Boundaries",
    emptyStances: "No stances exist",
    createStanceTitle: "Create New Stance",
    alertStanceCreated: "Stance created successfully",
    alertStanceUpdated: "Stance updated successfully",
    alertStanceStatus: "Stance status updated successfully",

    // Lexemes
    lexemesTitle: "Lexemes",
    lexemesSubtitle: "Phoneme overrides and aliases for TTS",
    newLexeme: "New Lexeme",
    thGrapheme: "Grapheme",
    thType: "Type",
    thReading: "Phoneme / Canonical",
    thActive: "Active",
    lblGrapheme: "Grapheme",
    lblType: "Lexeme Type",
    lblReading: "Phonetic Reading or Alias Replacement",
    optPhoneme: "Phoneme (TTS Pronunciation)",
    optAlias: "Alias (Corporate Abbreviation)",
    createLexemeTitle: "New Lexeme",
    editLexemeTitle: "Edit Lexeme",
    emptyLexemes: "No lexemes exist",
    confirmDeleteLexemeTitle: "Confirm Delete",
    confirmDeleteLexemeMsg: "Delete lexeme ‘{0}’? This cannot be undone.",
    alertLexemeCreated: "Lexeme created successfully",
    alertLexemeUpdated: "Lexeme updated successfully",
    alertLexemeDeleted: "Lexeme deleted successfully",
    alertLexemeStatus: "Lexeme status updated successfully",
    alertDuplicateLexeme: "Lexeme grapheme already exists",

    // Chat History
    chatHistoryTitle: "Chat History",
    chatHistorySubtitle: "Inspect session grouped logs, user queries, and AI grounded answers",
    thSession: "Session",
    thSource: "Source",
    thQuestion: "Question",
    thQuestionTime: "Question Time",
    btnViewDetails: "View Details",
    lblQuestion: "User Question",
    lblAnswer: "AI Answer",
    lblQuestionAt: "Question Timestamp",
    lblAnswerAt: "Answer Timestamp",
    chatDetailTitle: "Chat Turn Details",
    chatId: "Chat ID",
    sessionId: "Session ID",
    emptyChatHistory: "No chat history exists",
    confirmDeleteChatTitle: "Confirm Delete",
    confirmDeleteChatMsg: "Soft-delete this chat record. The record will be hidden from the list.",
    alertChatDeleted: "Chat record soft-deleted successfully",
    sessionTurnsTitle: "Dialogue turns in session:",
    turnsUnit: "turns",

    // Backgrounds
    backgroundsTitle: "Backgrounds",
    backgroundsSubtitle: "Upload, delete, and choose which image the client displays. PNG / JPEG / WebP, up to 10 MB.",
    uploadImage: "Upload image",
    uploadingImage: "Uploading image…",
    btnSetActive: "Set as active",
    badgeCurrentActive: "Currently Active",
    emptyBackgrounds: "No background images exist",
    confirmDeleteBgTitle: "Confirm Delete",
    confirmDeleteBgMsg: "Delete this background? The client will stop showing it.",
    alertImageSuccess: "Background image uploaded successfully",
    alertImageFormat: "Unsupported image format. Please upload a PNG, JPEG, or WebP file",
    alertImageSize: "Image size must not exceed 10 MB",
    alertImageUploadFailed: "Failed to upload image. Please try again",
    alertBgDeleted: "Background deleted successfully",
    alertBgDeleteFailed: "Failed to delete image. Please try again",
    alertBgActiveUpdated: "Active background updated successfully",
    alertBgUpdateFailed: "Failed to update the active background. Please try again",
    bgDefault: "Modern Office Interior (Default)",
    bgHall: "International Conference Hall",

    // Settings
    settingsTitle: "Settings",
    settingsSubtitle: "Configure client behaviors, language preferences, and Web Client password",
    clientBehaviorSection: "Client Behavior",
    lockToggle: "Lock Client Settings",
    lockDesc: "Prevent Unity client from overriding settings",
    avatarToggle: "Avatar Enabled",
    avatarDesc: "Show 3D/2D assistant avatar",
    voiceToggle: "Voice Enabled",
    voiceDesc: "Enable text-to-speech responses",
    authToggle: "Client login",
    authDesc: "Require visitors to log in before using the web client. Turn off to open the client to anyone with the URL.",
    defaultLangSection: "Default Language Preferences",
    defaultUiLang: "Default UI Language",
    defaultUiLangDesc: "Language the web client opens in for a first-time visitor. Their own choice is remembered afterwards.",
    defaultMicLang: "Default Mic Language",
    defaultMicLangDesc: "Speech-input language pre-selected in the web client. Follow UI language keeps them in step; Auto detects any language but has no live interim text.",
    defaultTranslateA: "Default Translate Source Language (A)",
    defaultTranslateDesc: "Language pair interpreter mode starts with. Applies only until the visitor picks their own.",
    clientPasswordSection: "User Password (Web Client)",
    clientPasswordDesc: "Set the password visitors enter to open the web client.",
    clientPasswordMissing: "No password set.",
    clientPasswordMissingOpen: "No password set - the web client is currently open.",
    clientPasswordConfigured: "A password is set.",
    clientUsernameLabel: "Username",
    newPasswordLabel: "New password",
    newPasswordPlaceholder: "Enter a new password",
    btnManageClientPassword: "User Password",
    btnSetPassword: "Set Password",
    btnSaveSettings: "Save Settings",
    alertPasswordUpdated: "Web Client password updated successfully!",
    alertPasswordUpdateFailed: "Failed to update password. Please try again.",
    alertSettingsSaved: "Settings saved successfully!",
    alertLogoutFailed: "Logout failed. Please try again.",
    chooseFileBtn: "Choose file",
    noFileChosen: "No file chosen",
    selectedFilesLabel: "Selected",
    uploadingFile: "Uploading…",
    alertUploadFailed: "Failed to upload files. Please try again.",
    previewLoading: "Opening document…",
    previewMissing: "The original file is unavailable. Upload it again to preview its contents.",
    previewFailed: "This document could not be displayed.",
    previewEmpty: "This sheet is empty.",
    langJa: "Japanese (ja)",
    langEn: "English (en)",
    langVi: "Vietnamese (vi)",
    langZh: "Chinese (zh)",
    phAssistantName: "e.g. Enterprise Virtual Assistant",
    phFilename: "company_guidelines.html",
    phStanceName: "e.g. Standard Stance",
    phTone: "e.g. Courteous & polite",
    phAttitude: "e.g. Supportive and attentive",
    phLexicon: "e.g. Corporate standard phrasing",
    phPrecision: "e.g. Concise, factual answers",
    phBoundaries: "e.g. Only answer from verified materials",
    phGrapheme: "e.g. AIMind",
    phReading: "e.g. A-I Mind Technology",
    typePhoneme: "Phoneme",
    typeAlias: "Alias",
    micLangEn: "English (en-US)",
    micLangVi: "Vietnamese (vi-VN)",
    micLangJa: "Japanese (ja-JP)",
    micLangZh: "Chinese (zh-CN)",
    defaultTone: "Courteous & formal",
    defaultAttitude: "Supportive",
    defaultLexicon: "Standard rhythm",
    defaultPrecision: "Accurate & concise",
    defaultBoundaries: "Grounded strictly in knowledge base",
    uploadedUrlSampleContent: "Web scraped documentation imported from {0}. Preprocessed and embedded for RAG contextual retrieval.",
    ocrSampleResult: "[OCR Result - {0}]\nAI Mind Technology JSC - Decision No. 0402346569/QD-AIMIND\nArticle 1: Corporate regulations regarding generative AI models, vector embeddings, and enterprise knowledge confidentiality.\nArticle 2: All staff interacting with conversational AI kiosks must adhere to information security protocols.",
  },
  ja: {
    brand: "AI Virtual Assistant System",
    subBrand: "管理パネル",
    admin: "管理者",
    logout: "ログアウト",

    tabDashboard: "ダッシュボード",
    tabSettings: "システム設定",
    tabAssistants: "アシスタント",
    tabStances: "スタンス設定",
    tabKnowledgeBase: "ナレッジベース",
    tabLexemes: "発音辞書",
    tabChatHistory: "会話履歴",
    tabBackgrounds: "背景画像",

    dashboardTitle: "ダッシュボード",
    welcome: "おかえりなさい、管理者様",
    assistants: "アシスタント",
    chatSessions: "チャットセッション",
    kbDocuments: "KBドキュメント",
    ragChunks: "RAGチャンク",
    activeAssistants: "アクティブなアシスタント",
    totalConversations: "総会話数",
    uploadedFiles: "アップロードされたファイル",
    vectorPoints: "Qdrantベクトルポイント",
    recentActivity: "最近のアクティビティ",
    quickStats: "システム状態",

    assistantsTitle: "アシスタント管理",
    assistantsSubtitle: "アシスタントのペルソナと指示プロンプトの管理",
    newAssistant: "新規アシスタント",
    thId: "ID",
    thName: "アシスタント名",
    thVersion: "バージョン",
    thState: "状態",
    thActions: "操作",
    btnEdit: "編集",
    btnStances: "スタンス",
    btnDelete: "削除",
    badgeActive: "有効",
    badgeInactive: "無効",
    assistantNameLabel: "アシスタント名",
    versionLabel: "バージョン",
    stateLabel: "状態",
    personaJsonLabel: "ペルソナ設定 (JSON)",
    btnSave: "変更を保存",
    btnCreate: "作成",
    btnUpdate: "更新",
    btnCancel: "キャンセル",
    btnConfirm: "確認",
    emptyAssistants: "アシスタントが存在しません",
    confirmDeleteAssistantTitle: "アシスタントの削除確認",
    confirmDeleteAssistantMsg: "このアシスタント設定を削除してもよろしいですか？",
    alertReqFields: "必須項目をすべて入力してください",
    alertDuplicateAssistant: "アシスタント名とバージョンの組み合わせが既に存在します",
    alertInvalidJson: "無効なJSONフォーマットです",
    alertAssistantCreated: "アシスタントを正常に作成しました",
    alertAssistantUpdated: "アシスタントを正常に更新しました",
    alertAssistantDeleted: "アシスタントを正常に削除しました",

    kbTitle: "ナレッジベース管理",
    kbSubtitle: "Google Cloud Storage - knowledge-base",
    quotaUsagePrefix: "使用容量: ",
    allFolders: "すべてのフォルダ",
    filesTotalSuffix: "件のファイル",
    showingRange: "{2}件中 {0}–{1}件を表示",
    tabKbFiles: "ファイル一覧",
    tabKbOcr: "OCRアップロード",
    uploadUrl: "URLアップロード",
    uploadFile: "ファイルアップロード",
    btnUpload: "アップロード",
    searchPlaceholder: "ファイル名で検索...",
    thFileName: "ファイル名",
    thFileSize: "サイズ",
    thStatus: "ステータス",
    thFolder: "フォルダ",
    thUpdated: "更新日時",
    statusDone: "完了",
    statusPending: "待機中",
    statusProcessing: "処理中",
    statusFailed: "失敗",
    statusNotIndexed: "未インデックス",
    btnPreview: "プレビュー",
    btnDownload: "ダウンロード",
    btnReprocess: "再処理",
    emptyFiles: "ファイルが存在しません",
    noMatchFiles: "検索に一致するファイルが見つかりません",
    uploadFileModalTitle: "ファイルをナレッジベースにアップロード",
    chooseFiles: "ファイルを選択",
    dragDropHint: "またはここにドラッグ＆ドロップ",
    targetFolder: "保存先フォルダ",
    rootFolder: "ルートフォルダ (root)",
    customFolderPlaceholder: "新規フォルダ名を入力...",
    alertSelectFile: "アップロードするファイルを1つ以上選択してください",
    alertUnsupportedFormat: "サポートされていないファイル形式です",
    alertStorageQuota: "ストレージ容量（1.0 GB）を超過しました",
    alertUploadSuccess: "ファイルを正常にアップロードしました",
    uploadUrlModalTitle: "URLからドキュメントを取り込み",
    sourceUrl: "ソースURL",
    saveAsFilename: "保存ファイル名（任意）",
    btnFetchUpload: "取得＆取り込み",
    alertEnterUrl: "有効なURLを入力してください",
    alertInvalidUrl: "URL形式が無効です",
    alertImportSuccess: "ドキュメントを正常に取り込みました",
    previewModalTitle: "ドキュメントプレビュー",
    btnOpenLink: "リンクを開く",
    confirmDeleteFileTitle: "ファイルの削除確認",
    confirmDeleteFileMsg: "この操作は取り消せません。ストレージおよびQdrantから削除されます。",
    alertFileDeleted: "ファイルを正常に削除しました",
    alertReprocessQueued: "再インデックス処理をキューに追加しました",

    ocrTitle: "OCRテキスト抽出とインデックス",
    ocrSubtitle: "スキャン画像からテキストを抽出し、編集・Qdrantへ登録",
    ocrSelectFile: "ファイルを選択",
    ocrSelectFilesBtn: "ファイルを選択",
    targetKbFolder: "保存先KBフォルダ",
    autoIndexQdrant: "Qdrantへの自動インデックス",
    btnRunOcr: "OCRを実行",
    btnSaveToKb: "ナレッジベースへ保存",
    ocrStatusReady: "OCR実行待機中",
    ocrStatusRunning: "Gemini Vision OCR実行中...",
    ocrStatusDone: "OCR抽出完了 - 内容を確認・編集できます:",
    alertOcrSuccess: "OCR抽出内容を正常に保存しました",
    alertOcrSavedNoIndex: "OCR抽出内容をナレッジベースに保存しました（RAG未インデックス）",
    alertOcrUnsupportedFormat: "サポートされていないファイル形式です。画像、PDF、HTML、またはプレーンテキストファイルをアップロードしてください",
    alertEmptyOcr: "抽出テキストを入力してください",

    stancesTitle: "スタンス設定",
    stancesSubtitle: "会話のトーン、態度、言葉遣い、応答制限の設定",
    newStance: "新規スタンス",
    filterByAssistant: "アシスタントで絞り込み:",
    allAssistants: "すべてのアシスタント",
    lblAssistant: "対象アシスタント",
    thAssistant: "アシスタント",
    thStanceId: "スタンスID",
    thStanceName: "スタンス名",
    btnView: "詳細",
    lblStanceName: "スタンス名",
    lblVersion: "バージョン",
    lblTone: "トーン",
    lblAttitude: "態度",
    lblLexicon: "用語・リズム",
    lblPrecision: "簡潔さ・正確性",
    lblBoundaries: "境界・ルール",
    emptyStances: "スタンスが存在しません",
    createStanceTitle: "新規スタンス作成",
    alertStanceCreated: "スタンスを作成しました",
    alertStanceUpdated: "スタンスを更新しました",
    alertStanceStatus: "スタンス状態を更新しました",

    lexemesTitle: "発音辞書 (レクシーム)",
    lexemesSubtitle: "TTS用の音素オーバーライドとエイリアス設定",
    newLexeme: "新規レクシーム",
    thGrapheme: "表記",
    thType: "種別",
    thReading: "音素 / 置換語",
    thActive: "有効",
    lblGrapheme: "表記",
    lblType: "種別",
    lblReading: "読み仮名または置換語",
    optPhoneme: "音素 (音声発音)",
    optAlias: "エイリアス (略語・同義語)",
    createLexemeTitle: "新規発音語登録",
    editLexemeTitle: "発音語の編集",
    emptyLexemes: "レクシームが存在しません",
    confirmDeleteLexemeTitle: "削除確認",
    confirmDeleteLexemeMsg: "レクシーム ‘{0}’ を削除しますか？",
    alertLexemeCreated: "レクシームを作成しました",
    alertLexemeUpdated: "レクシームを更新しました",
    alertLexemeDeleted: "レクシームを削除しました",
    alertLexemeStatus: "状態を更新しました",
    alertDuplicateLexeme: "既に登録されている表記です",

    chatHistoryTitle: "会話履歴",
    chatHistorySubtitle: "セッション別ログ、ユーザーの質問、AIの回答履歴",
    thSession: "セッション",
    thSource: "ソース",
    thQuestion: "質問",
    thQuestionTime: "質問日時",
    btnViewDetails: "詳細表示",
    lblQuestion: "質問",
    lblAnswer: "AI回答",
    lblQuestionAt: "質問日時",
    lblAnswerAt: "回答日時",
    chatDetailTitle: "対話詳細情報",
    chatId: "チャットID",
    sessionId: "セッションID",
    emptyChatHistory: "会話履歴が存在しません",
    confirmDeleteChatTitle: "チャット履歴の論理削除",
    confirmDeleteChatMsg: "このレコードを論理削除しますか？",
    alertChatDeleted: "チャットレコードを削除しました",
    sessionTurnsTitle: "セッション内のやり取り一覧:",
    turnsUnit: "件",

    backgroundsTitle: "背景画像管理",
    backgroundsSubtitle: "クライアントに表示する背景画像をアップロード・削除・選択します。PNG / JPEG / WebP、最大 10 MB。",
    uploadImage: "画像をアップロード",
    uploadingImage: "画像をアップロード中…",
    btnSetActive: "適用する",
    badgeCurrentActive: "現在適用中",
    emptyBackgrounds: "背景画像がありません",
    confirmDeleteBgTitle: "背景画像の削除確認",
    confirmDeleteBgMsg: "この背景画像を削除しますか？",
    alertImageSuccess: "背景画像をアップロードしました",
    alertImageFormat: "サポートされていない画像形式です",
    alertImageSize: "画像サイズは10MB以内である必要があります",
    alertImageUploadFailed: "画像をアップロードできませんでした。もう一度お試しください。",
    alertBgDeleted: "背景画像を削除しました",
    alertBgDeleteFailed: "背景画像を削除できませんでした。もう一度お試しください。",
    alertBgActiveUpdated: "適用中の背景を切り替えました",
    alertBgUpdateFailed: "背景を変更できませんでした。もう一度お試しください。",
    bgDefault: "オフィス内観（デフォルト）",
    bgHall: "国際会議ホール",

    settingsTitle: "システム設定",
    settingsSubtitle: "クライアント動作、言語設定、認証パスワードの設定",
    clientBehaviorSection: "クライアント動作設定",
    lockToggle: "クライアント設定をロック",
    lockDesc: "Unityクライアントによる設定の上書きを防止します",
    avatarToggle: "アバター表示",
    avatarDesc: "3D/2Dのアシスタントアバターを表示します",
    voiceToggle: "音声出力",
    voiceDesc: "回答を音声で読み上げます",
    authToggle: "クライアントログイン",
    authDesc: "Webクライアントの利用前にログインを求めます。オフにすると、URLを知っている人は誰でも利用できます。",
    defaultLangSection: "デフォルト言語設定",
    defaultUiLang: "デフォルトUI言語",
    defaultUiLangDesc: "初回訪問時にWebクライアントで表示される言語です。以降は利用者が選んだ言語を記憶します。",
    defaultMicLang: "デフォルトマイク音声言語",
    defaultMicLangDesc: "Webクライアントで事前に選択される音声入力言語です。「表示言語に合わせる」で表示言語と同期します。「自動」は言語を検出しますが、発話中の途中結果は表示しません。",
    defaultTranslateA: "翻訳元デフォルト言語 (A)",
    defaultTranslateDesc: "通訳モードの開始時に使う言語の組み合わせです。利用者が自分で選ぶまで適用されます。",
    clientPasswordSection: "ユーザーパスワード（Webクライアント）",
    clientPasswordDesc: "Webクライアントへのアクセスに使用するパスワードを設定します。",
    clientPasswordMissing: "パスワードは設定されていません。",
    clientPasswordMissingOpen: "パスワードは未設定です。現在、Webクライアントにはログインせずにアクセスできます。",
    clientPasswordConfigured: "パスワードは設定済みです。",
    clientUsernameLabel: "ユーザー名",
    newPasswordLabel: "新しいパスワード",
    newPasswordPlaceholder: "新しいパスワードを入力",
    btnManageClientPassword: "ユーザーパスワード",
    btnSetPassword: "パスワード設定",
    btnSaveSettings: "設定を保存",
    alertPasswordUpdated: "パスワードを更新しました",
    alertPasswordUpdateFailed: "パスワードを更新できませんでした。もう一度お試しください。",
    alertSettingsSaved: "設定を正常に保存しました",
    alertLogoutFailed: "ログアウトできませんでした。もう一度お試しください。",
    chooseFileBtn: "ファイルを選択",
    noFileChosen: "選択されていません",
    selectedFilesLabel: "選択済み",
    uploadingFile: "アップロード中…",
    alertUploadFailed: "ファイルをアップロードできませんでした。もう一度お試しください。",
    previewLoading: "ドキュメントを開いています…",
    previewMissing: "元のファイルが見つかりません。プレビューするには再度アップロードしてください。",
    previewFailed: "このドキュメントは表示できません。",
    previewEmpty: "このシートは空です。",
    langJa: "日本語 (ja)",
    langEn: "英語 (en)",
    langVi: "ベトナム語 (vi)",
    langZh: "中国語 (zh)",
    phAssistantName: "例: 社内バーチャルアシスタント",
    phFilename: "company_guidelines.html",
    phStanceName: "例: 基本姿勢",
    phTone: "例: 礼儀正しく丁寧",
    phAttitude: "例: 親切で落ち着いた対応",
    phLexicon: "例: ビジネス標準表現",
    phPrecision: "例: 簡潔で正確な回答",
    phBoundaries: "例: 検証済み資料のみに基づき回答",
    phGrapheme: "例: AIMind",
    phReading: "例: エーアイマインド",
    typePhoneme: "音素",
    typeAlias: "エイリアス",
    micLangEn: "英語 (en-US)",
    micLangVi: "ベトナム語 (vi-VN)",
    micLangJa: "日本語 (ja-JP)",
    micLangZh: "中国語 (zh-CN)",
    defaultTone: "礼儀正しくフォーマル",
    defaultAttitude: "親切で丁寧",
    defaultLexicon: "標準的なビジネス表現",
    defaultPrecision: "正確かつ簡潔",
    defaultBoundaries: "ナレッジベースの検証済み資料のみに基づき回答",
    uploadedUrlSampleContent: "{0} から取り込まれたWebドキュメントです。RAGコンテキスト検索用に前処理およびベクトル化されています。",
    ocrSampleResult: "[OCR抽出結果 - {0}]\nAI Mind Technology株式会社 - 規定第0402346569号\n第1条：生成AIモデル、ベクトル埋め込み、および社内ナレッジの機密保持に関する規定。\n第2条：対話型AIキオスクを利用する全社員は情報セキュリティ手順を遵守するものとします。",
  },
  zh: {
    brand: "AI Virtual Assistant System",
    subBrand: "管理后台",
    admin: "管理员",
    logout: "退出登录",

    tabDashboard: "仪表盘",
    tabSettings: "系统设置",
    tabAssistants: "助手",
    tabStances: "风格设置",
    tabKnowledgeBase: "知识库管理",
    tabLexemes: "发音词典",
    tabChatHistory: "对话历史",
    tabBackgrounds: "背景图库",

    dashboardTitle: "仪表盘",
    welcome: "欢迎回来，管理员",
    assistants: "助手",
    chatSessions: "对话会话",
    kbDocuments: "知识库文档",
    ragChunks: "RAG 文本块",
    activeAssistants: "活跃助手",
    totalConversations: "总对话次数",
    uploadedFiles: "已上传文件",
    vectorPoints: "Qdrant 向量节点",
    recentActivity: "近期活动",
    quickStats: "系统健康度",

    assistantsTitle: "虚拟助手管理",
    assistantsSubtitle: "管理虚拟助手人设与提示词规范",
    newAssistant: "新增助手",
    thId: "ID",
    thName: "助手名称",
    thVersion: "版本",
    thState: "状态",
    thActions: "操作",
    btnEdit: "编辑",
    btnStances: "风格",
    btnDelete: "删除",
    badgeActive: "启用中",
    badgeInactive: "已停用",
    assistantNameLabel: "助手名称",
    versionLabel: "版本",
    stateLabel: "状态",
    personaJsonLabel: "人设配置 (JSON)",
    btnSave: "保存更改",
    btnCreate: "创建",
    btnUpdate: "更新",
    btnCancel: "取消",
    btnConfirm: "确认",
    emptyAssistants: "目前无虚拟助手",
    confirmDeleteAssistantTitle: "确认删除助手",
    confirmDeleteAssistantMsg: "您确定要删除此助手配置吗？系统将执行软删除以维护历史数据完整性。",
    alertReqFields: "请填写所有必填字段",
    alertDuplicateAssistant: "助手名称与版本组合已存在",
    alertInvalidJson: "JSON 格式无效",
    alertAssistantCreated: "助手创建成功",
    alertAssistantUpdated: "助手更新成功",
    alertAssistantDeleted: "助手删除成功",

    kbTitle: "知识库文档管理",
    kbSubtitle: "Google Cloud Storage - knowledge-base",
    quotaUsagePrefix: "已用空间: ",
    allFolders: "全部文件夹",
    filesTotalSuffix: "个文件",
    showingRange: "显示第 {0}–{1} 项，共 {2} 项",
    tabKbFiles: "文档列表",
    tabKbOcr: "OCR 上传",
    uploadUrl: "上传 URL",
    uploadFile: "上传文件",
    btnUpload: "上传",
    searchPlaceholder: "按名称搜索文件...",
    thFileName: "名称",
    thFileSize: "大小",
    thStatus: "状态",
    thFolder: "文件夹",
    thUpdated: "修改时间",
    statusDone: "已完成",
    statusPending: "等待中",
    statusProcessing: "处理中",
    statusFailed: "失败",
    statusNotIndexed: "未建立索引",
    btnPreview: "预览",
    btnDownload: "下载",
    btnReprocess: "重新处理",
    emptyFiles: "暂无文件",
    noMatchFiles: "未找到符合搜索条件的文件",
    uploadFileModalTitle: "上传文件至知识库",
    chooseFiles: "选择文件",
    dragDropHint: "或将文件拖拽至此处",
    targetFolder: "目标文件夹",
    rootFolder: "根目录 (root)",
    customFolderPlaceholder: "输入新文件夹名称...",
    alertSelectFile: "请至少选择一个文件上传",
    alertUnsupportedFormat: "不支持的文件格式",
    alertStorageQuota: "超出存储配额限制 (1.0 GB)",
    alertUploadSuccess: "文件上传成功",
    uploadUrlModalTitle: "从网址导入文档",
    sourceUrl: "来源网址 (URL)",
    saveAsFilename: "保存文件名 (选填)",
    btnFetchUpload: "抓取并上传",
    alertEnterUrl: "请输入有效网址",
    alertInvalidUrl: "网址格式不正确",
    alertImportSuccess: "文档导入成功",
    previewModalTitle: "文档内容预览",
    btnOpenLink: "打开链接",
    confirmDeleteFileTitle: "确认删除文件",
    confirmDeleteFileMsg: "此操作无法撤销，文件及对应向量将被永久删除。",
    alertFileDeleted: "文件删除成功",
    alertReprocessQueued: "重新处理任务已加入队列",

    ocrTitle: "OCR 文字提取与向量化",
    ocrSubtitle: "从扫描文档或图片提取文字，校对后存入知识库并同步至 Qdrant",
    ocrSelectFile: "选择文件",
    ocrSelectFilesBtn: "选择文件",
    targetKbFolder: "目标文件夹路径",
    autoIndexQdrant: "自动同步索引至 RAG (Qdrant)",
    btnRunOcr: "执行 OCR 识别",
    btnSaveToKb: "存入知识库",
    ocrStatusReady: "就绪，等待执行识别",
    ocrStatusRunning: "Gemini Vision OCR 识别中...",
    ocrStatusDone: "OCR 识别完成 - 请在下方查看或编辑内容:",
    alertOcrSuccess: "OCR 内容已保存并建立向量索引！",
    alertOcrSavedNoIndex: "OCR 内容已存入知识库（未建立 RAG 索引）",
    alertOcrUnsupportedFormat: "不支持的文件格式。请上传图片、PDF、HTML 或纯文本文件",
    alertEmptyOcr: "识别内容不能为空",

    stancesTitle: "风格与语气设置",
    stancesSubtitle: "配置对话语气、态度、用词节奏与回复边界",
    newStance: "新增风格",
    filterByAssistant: "按助手筛选:",
    allAssistants: "全部助手",
    lblAssistant: "关联助手",
    thAssistant: "助手",
    thStanceId: "风格 ID",
    thStanceName: "风格名称",
    btnView: "查看",
    lblStanceName: "风格名称",
    lblVersion: "版本",
    lblTone: "语调",
    lblAttitude: "态度",
    lblLexicon: "用词与节奏",
    lblPrecision: "简洁度与精确度",
    lblBoundaries: "回复范围边界",
    emptyStances: "暂未配置任何风格",
    createStanceTitle: "新增对话风格",
    alertStanceCreated: "对话风格创建成功",
    alertStanceUpdated: "对话风格更新成功",
    alertStanceStatus: "风格状态更新成功",

    lexemesTitle: "发音词典",
    lexemesSubtitle: "TTS 语音合成的音素覆盖与别名配置",
    newLexeme: "新增词条",
    thGrapheme: "词形",
    thType: "类型",
    thReading: "音素 / 标准读法",
    thActive: "启用",
    lblGrapheme: "词形",
    lblType: "词条类型",
    lblReading: "发音或同义替换词",
    optPhoneme: "音素 (语音发音)",
    optAlias: "别名 (缩写对应)",
    createLexemeTitle: "新增发音词条",
    editLexemeTitle: "编辑发音词条",
    emptyLexemes: "暂无词条",
    confirmDeleteLexemeTitle: "确认删除",
    confirmDeleteLexemeMsg: "删除词条 ‘{0}’？此操作无法撤销。",
    alertLexemeCreated: "词条创建成功",
    alertLexemeUpdated: "词条更新成功",
    alertLexemeDeleted: "词条删除成功",
    alertLexemeStatus: "状态更新成功",
    alertDuplicateLexeme: "该词形已存在",

    chatHistoryTitle: "对话历史记录",
    chatHistorySubtitle: "按会话查看记录、用户提问与 AI 回复",
    thSession: "会话",
    thSource: "来源",
    thQuestion: "问题",
    thQuestionTime: "提问时间",
    btnViewDetails: "查看详情",
    lblQuestion: "提问内容",
    lblAnswer: "AI 回复内容",
    lblQuestionAt: "提问时间",
    lblAnswerAt: "回答时间",
    chatDetailTitle: "对话详情查看",
    chatId: "对话 ID",
    sessionId: "会话 ID",
    emptyChatHistory: "暂无对话记录",
    confirmDeleteChatTitle: "软删除对话记录",
    confirmDeleteChatMsg: "软删除此对话记录，将从列表中隐藏。",
    alertChatDeleted: "对话记录已成功软删除",
    sessionTurnsTitle: "该会话对话列表:",
    turnsUnit: "轮",

    backgroundsTitle: "背景图库管理",
    backgroundsSubtitle: "上传、删除并选择客户端显示的背景图片。支持 PNG / JPEG / WebP，最大 10 MB。",
    uploadImage: "上传图片",
    uploadingImage: "正在上传图片…",
    btnSetActive: "设为当前背景",
    badgeCurrentActive: "当前使用中",
    emptyBackgrounds: "暂无背景图片",
    confirmDeleteBgTitle: "确认删除背景图片",
    confirmDeleteBgMsg: "删除此背景图片？客户端将停止显示。",
    alertImageSuccess: "背景图片上传成功",
    alertImageFormat: "不支持的图片格式，请上传 PNG、JPEG 或 WebP",
    alertImageSize: "图片大小不可超过 10 MB",
    alertImageUploadFailed: "上传图片失败，请重试。",
    alertBgDeleted: "背景图片删除成功",
    alertBgDeleteFailed: "删除图片失败，请重试。",
    alertBgActiveUpdated: "已切换启用中的背景图片",
    alertBgUpdateFailed: "切换背景失败，请重试。",
    bgDefault: "现代办公室室内 (默认)",
    bgHall: "国际会议展览厅",

    settingsTitle: "系统设置",
    settingsSubtitle: "Web 端参数设置、语言偏好与访问安全防护",
    clientBehaviorSection: "客户端行为设置",
    lockToggle: "鎖定用戶端設定",
    lockDesc: "防止 Unity 用戶端覆寫設定",
    avatarToggle: "啟用虛擬角色",
    avatarDesc: "顯示 3D/2D 助理角色",
    voiceToggle: "啟用語音",
    voiceDesc: "以語音朗讀回覆",
    authToggle: "用戶端登入",
    authDesc: "要求訪客登入後才能使用 Web 用戶端。關閉後，任何知道網址的人都可存取。",
    defaultLangSection: "默认语言选项",
    defaultUiLang: "默认界面语言",
    defaultUiLangDesc: "訪客首次開啟 Web 用戶端時使用的語言。之後會記住訪客自己選擇的語言。",
    defaultMicLang: "默认麦克风语言",
    defaultMicLangDesc: "Web 用戶端預先選取的語音輸入語言。「跟隨介面語言」會讓兩者保持一致。「自動」會偵測語言，但說話時不會顯示即時辨識的暫時文字。",
    defaultTranslateA: "默认翻译源语言 (A)",
    defaultTranslateDesc: "啟動口譯模式時使用的語言組合。訪客自行選擇語言組合後，會改用其選擇。",
    clientPasswordSection: "用户密码（Web 客户端）",
    clientPasswordDesc: "设置访客打开 Web 客户端时使用的密码。",
    clientPasswordMissing: "尚未设置密码。",
    clientPasswordMissingOpen: "尚未设置密码，当前可直接访问 Web 客户端。",
    clientPasswordConfigured: "已设置密码。",
    clientUsernameLabel: "用户名",
    newPasswordLabel: "新密码",
    newPasswordPlaceholder: "输入新密码",
    btnManageClientPassword: "用户密码",
    btnSetPassword: "保存密码",
    btnSaveSettings: "保存设置",
    alertPasswordUpdated: "Web 客户端密码更新成功！",
    alertPasswordUpdateFailed: "无法更新密码。请重试。",
    alertSettingsSaved: "系统设置已成功保存！",
    alertLogoutFailed: "退出登录失败。请重试。",
    chooseFileBtn: "选择文件",
    noFileChosen: "未选择任何文件",
    selectedFilesLabel: "已选择",
    uploadingFile: "正在上傳…",
    alertUploadFailed: "上傳檔案失敗。請重試。",
    previewLoading: "正在開啟文件…",
    previewMissing: "找不到原始檔案。請重新上傳以預覽內容。",
    previewFailed: "無法顯示此文件。",
    previewEmpty: "此工作表沒有資料。",
    langJa: "日语 (ja)",
    langEn: "英语 (en)",
    langVi: "越南语 (vi)",
    langZh: "中文 (zh)",
    phAssistantName: "例如：企业虚拟助手",
    phFilename: "company_guidelines.html",
    phStanceName: "例如：基本姿态",
    phTone: "例如：礼貌、庄重",
    phAttitude: "例如：专业且热忱协助",
    phLexicon: "例如：标准企业用语",
    phPrecision: "例如：简洁准确，依据事实回答",
    phBoundaries: "例如：仅依据已验证资料回答",
    phGrapheme: "例如：AIMind",
    phReading: "例如：A-I Mind Technology",
    typePhoneme: "音素",
    typeAlias: "别名",
    micLangEn: "英语 (en-US)",
    micLangVi: "越南语 (vi-VN)",
    micLangJa: "日语 (ja-JP)",
    micLangZh: "中文 (zh-CN)",
    defaultTone: "礼貌且庄重",
    defaultAttitude: "专业且热忱协助",
    defaultLexicon: "标准企业用语",
    defaultPrecision: "准确且简洁",
    defaultBoundaries: "严格依据知识库已验证资料回答",
    uploadedUrlSampleContent: "从网址 {0} 导入的网页文档。已完成预处理并向量化，用于 RAG 上下文检索。",
    ocrSampleResult: "[OCR 识别结果 - {0}]\nAI Mind Technology 股份公司 - 第 0402346569 号决议\n第一条：关于生成式 AI 模型、向量嵌入及企业知识库保密的内部管理规定。\n第二条：所有与对话式 AI 终端交互的员工均须严格遵守信息安全规范。",
  },
};

export const VALID_TABS: readonly Tab[] = [
  "dashboard",
  "assistants",
  "stances",
  "knowledge-base",
  "lexemes",
  "chat-history",
  "backgrounds",
  "settings",
];

export const VALID_LANGS: readonly Lang[] = ["vi", "en", "ja", "zh"];

function persistLangCookie(nextLang: Lang) {
  document.cookie = `admin_lang=${nextLang}; path=/; max-age=31536000; samesite=lax`;
}

export function AdminClient({
  initialTab = "dashboard",
  initialLang = "en",
}: {
  initialTab?: Tab;
  initialLang?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [kbSubTab, setKbSubTab] = useState<"files" | "ocr">("files");
  const [kbFolderFilter, setKbFolderFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => listenForLogout("admin"), []);

  // Sync with browser Back/Forward navigation and backfill cookie if only localStorage was set previously
  useEffect(() => {
    const hasCookie = document.cookie.split(";").some((c) => c.trim().startsWith("admin_lang="));
    if (!hasCookie) {
      const savedLang = window.localStorage.getItem("admin_lang") as Lang | null;
      if (savedLang && VALID_LANGS.includes(savedLang)) {
        persistLangCookie(savedLang);
        if (savedLang !== lang) setLang(savedLang);
      }
    }

    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab") as Tab | null;
      if (tabParam && VALID_TABS.includes(tabParam)) {
        setActiveTab(tabParam);
      } else {
        setActiveTab("dashboard");
      }
      const langParam = params.get("lang") as Lang | null;
      if (langParam && VALID_LANGS.includes(langParam)) {
        setLang(langParam);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTab = (nextTab: Tab) => {
    setActiveTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextTab === "dashboard") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", nextTab);
      }
      window.history.pushState(null, "", url.toString());
    }
  };

  const selectLang = (nextLang: Lang) => {
    setLang(nextLang);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("admin_lang", nextLang);
      persistLangCookie(nextLang);
    }
  };

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  const text = t[lang];
  const isSettingsTab = activeTab === "settings";
  const workspacePadding = isSettingsTab || activeTab === "chat-history" ? "px-3 sm:px-6 lg:px-8" : "px-8";

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout("admin");
    } catch {
      showToast(text.alertLogoutFailed, "error");
      setIsLoggingOut(false);
    }
  };

  // Helper function to extract localized string if object, else string
  const getVal = (val: Record<Lang, string> | string | undefined): string => {
    if (!val) return "";
    if (typeof val === "object") {
      return val[lang] || val.vi || val.en || Object.values(val)[0] || "";
    }
    return String(val);
  };

  // Helper function to return active tab name in current language
  const getTabLabel = (tabKey: Tab) => {
    switch (tabKey) {
      case "dashboard":
        return text.tabDashboard;
      case "settings":
        return text.tabSettings;
      case "assistants":
        return text.tabAssistants;
      case "stances":
        return text.tabStances;
      case "knowledge-base":
        return text.tabKnowledgeBase;
      case "lexemes":
        return text.tabLexemes;
      case "chat-history":
        return text.tabChatHistory;
      case "backgrounds":
        return text.tabBackgrounds;
    }
  };

  // 1. ASSISTANTS STATE
  const [assistantsList, setAssistantsList] = useState<AssistantItem[]>([
    {
      id: 1,
      name: {
        vi: "Trợ lý Nội bộ Doanh nghiệp (Mặc định cũ)",
        en: "Internal Corporate Assistant (Legacy Default)",
        ja: "社内アシスタント（旧デフォルト）",
        zh: "企业内部助手（旧默认）",
      },
      version: "1.0.0",
      state: 0,
      persona: '{\n  "identity": "Internal Corporate Advisor",\n  "style": "Formal & Courteous"\n}',
    },
    {
      id: 2,
      name: {
        vi: "Hướng dẫn viên Dịch vụ & Khách hàng",
        en: "Customer Support & Service Guide",
        ja: "ワイズプランニング事業案内",
        zh: "客户服务导览助手",
      },
      version: "1.0.0",
      state: 0,
      persona: '{\n  "identity": "Customer Service Guide",\n  "style": "Polite & Helpful"\n}',
    },
    {
      id: 3,
      name: {
        vi: "Cố vấn AI Đa năng (Tổng quát)",
        en: "General AI Advisor",
        ja: "ワイズプランニング AIアドバイザー（汎用）",
        zh: "通用型 AI 顾问",
      },
      version: "1.0.0",
      state: 0,
      persona: '{\n  "identity": "General Knowledge Advisor",\n  "style": "Friendly & Precise"\n}',
    },
    {
      id: 5,
      name: {
        vi: "Trợ lý AI chính thức (Đang hoạt động)",
        en: "AI Virtual Assistant (Active Production)",
        ja: "本番用 AI アシスタント（稼働中）",
        zh: "正式运营 AI 助手 (启用中)",
      },
      version: "1.0.0",
      state: 1,
      persona: '{\n  "identity": "Primary Production Advisor",\n  "style": "Accurate & Grounded"\n}',
    },
  ]);

  const [isAssistantModalOpen, setIsAssistantModalOpen] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<AssistantItem | null>(null);
  const [assistantForm, setAssistantForm] = useState({
    name: "",
    version: "1.0.0",
    state: 0,
    personaText: '{\n  "identity": "AI Virtual Assistant",\n  "greeting": "Hello, how can I assist you?",\n  "instructions": "Answer questions grounded strictly in provided knowledge base."\n}',
  });
  const [deleteAssistantConfirmId, setDeleteAssistantConfirmId] = useState<number | null>(null);

  const handleOpenNewAssistant = () => {
    setEditingAssistant(null);
    setAssistantForm({
      name: "",
      version: "1.0.0",
      state: 0,
      personaText: '{\n  "identity": "AI Virtual Assistant",\n  "greeting": "Hello, how can I assist you?",\n  "instructions": "Answer questions grounded strictly in provided knowledge base."\n}',
    });
    setIsAssistantModalOpen(true);
  };

  const handleOpenEditAssistant = (ast: AssistantItem) => {
    setEditingAssistant(ast);
    setAssistantForm({
      name: ast.name[lang] || Object.values(ast.name)[0],
      version: ast.version,
      state: ast.state,
      personaText: ast.persona || "{}",
    });
    setIsAssistantModalOpen(true);
  };

  const handleSaveAssistant = () => {
    if (!assistantForm.name.trim() || !assistantForm.version.trim()) {
      showToast(text.alertReqFields, "error");
      return;
    }

    // Check duplicate Name + Version across other assistants
    const isDuplicate = assistantsList.some(
      (a) =>
        (!editingAssistant || a.id !== editingAssistant.id) &&
        (a.name[lang]?.trim().toLowerCase() === assistantForm.name.trim().toLowerCase() ||
          Object.values(a.name).some((v) => v.trim().toLowerCase() === assistantForm.name.trim().toLowerCase())) &&
        a.version.trim().toLowerCase() === assistantForm.version.trim().toLowerCase()
    );
    if (isDuplicate) {
      showToast(text.alertDuplicateAssistant, "error");
      return;
    }

    // JSON syntax validation
    try {
      JSON.parse(assistantForm.personaText);
    } catch {
      showToast(text.alertInvalidJson, "error");
      return;
    }

    if (editingAssistant) {
      setAssistantsList((prev) =>
        prev.map((item) =>
          item.id === editingAssistant.id
            ? {
                ...item,
                name: { ...item.name, [lang]: assistantForm.name },
                version: assistantForm.version,
                state: assistantForm.state,
                persona: assistantForm.personaText,
              }
            : assistantForm.state === 1 && item.id !== editingAssistant.id
            ? { ...item, state: 0 }
            : item
        )
      );
      showToast(text.alertAssistantUpdated, "success");
    } else {
      const newId = Math.max(...assistantsList.map((a) => a.id), 0) + 1;
      const newItem: AssistantItem = {
        id: newId,
        name: { vi: assistantForm.name, en: assistantForm.name, ja: assistantForm.name, zh: assistantForm.name },
        version: assistantForm.version,
        state: assistantForm.state,
        persona: assistantForm.personaText,
      };
      setAssistantsList((prev) => [
        ...prev.map((item) => (assistantForm.state === 1 ? { ...item, state: 0 } : item)),
        newItem,
      ]);
      showToast(text.alertAssistantCreated, "success");
    }
    setIsAssistantModalOpen(false);
  };

  const confirmDeleteAssistant = () => {
    if (deleteAssistantConfirmId !== null) {
      setAssistantsList((prev) => prev.filter((item) => item.id !== deleteAssistantConfirmId));
      showToast(text.alertAssistantDeleted, "success");
      setDeleteAssistantConfirmId(null);
    }
  };

  // 2. KNOWLEDGE BASE STATE
  const [files, setFiles] = useState<FileItem[]>([
    {
      id: 1,
      filename: "Employee_Handbook_2026.pdf",
      size: "2.4 MB",
      sizeBytes: 2516582,
      status: "done",
      updated: "2026-10-28 14:20",
      folder: "root",
      rawContent: "Section 3.2: The standard probation period for new technical employees is 2 months. All employees receive full medical benefits from their start date.",
    },
    {
      id: 2,
      filename: "Product_Architecture_Guide.docx",
      size: "1.1 MB",
      sizeBytes: 1153433,
      status: "done",
      updated: "2026-10-29 09:15",
      folder: "root",
      rawContent: "AI Virtual Assistant architecture leverages Celery asynchronous workers, Qdrant HNSW vector search, and Gemini Flash LLM orchestration.",
    },
    {
      id: 3,
      filename: "Customer_FAQ_Policy.html",
      size: "340 KB",
      sizeBytes: 348160,
      status: "done",
      updated: "2026-10-30 16:45",
      folder: "root",
      sourceUrl: "https://aimind.vn/faq",
      rawContent: "Q: What services does AI Mind provide? A: Enterprise AI Platform, Fintech AI, Conversational & Voice AI, and Computer Vision & Robotics.",
    },
    {
      id: 4,
      filename: "Financial_Report_Q3_2026.xlsx",
      size: "820 KB",
      sizeBytes: 839680,
      status: "done",
      updated: "2026-10-31 11:10",
      folder: "finance",
      rawContent: "Q3 2026 revenue increased 38% year-over-year. R&D investments reached $1.2M in vector database search and conversational agent hardware.",
    },
  ]);

  const [isUploadFileModalOpen, setIsUploadFileModalOpen] = useState(false);
  const [isUploadUrlModalOpen, setIsUploadUrlModalOpen] = useState(false);
  const [previewFileItem, setPreviewFileItem] = useState<FileItem | null>(null);
  const [deleteFileConfirmItem, setDeleteFileConfirmItem] = useState<FileItem | null>(null);

  // File Upload Form state
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [uploadTargetFolder, setUploadTargetFolder] = useState("root");
  const [customUploadFolder, setCustomUploadFolder] = useState("");

  // URL Upload Form state
  const [urlSourceInput, setUrlSourceInput] = useState("");
  const [urlCustomFilename, setUrlCustomFilename] = useState("");
  const [urlTargetFolder, setUrlTargetFolder] = useState("root");
  const [urlCustomFolder, setUrlCustomFolder] = useState("");

  // OCR state
  const [ocrSelectedFile, setOcrSelectedFile] = useState<string>("");
  const [ocrSelectedFileSize, setOcrSelectedFileSize] = useState<number>(0);
  const [ocrTargetFolder, setOcrTargetFolder] = useState(() => `ocr/${new Date().toISOString().slice(0, 10)}`);
  const [ocrAutoIndex, setOcrAutoIndex] = useState(true);
  const [ocrStatus, setOcrStatus] = useState<"idle" | "running" | "done">("idle");
  const [ocrExtractedText, setOcrExtractedText] = useState("");

  const isSupportedOcrFile = (name: string, mimeType: string) =>
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?|svg|pdf|html?|txt)$/i.test(name);

  // Active (non-soft-deleted) files & Storage Quota Calculation
  const activeFiles = files.filter((f) => !f.deleted);
  const totalBytes = activeFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
  const quotaMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const quotaPercentage = ((totalBytes / KB_STORAGE_QUOTA_BYTES) * 100).toFixed(1);

  const closeFileUpload = () => {
    setIsUploadFileModalOpen(false);
    setSelectedUploadFiles([]);
    setIsDraggingUpload(false);
  };

  const handleUploadFileSubmit = async () => {
    if (isUploadingFiles) return;
    if (selectedUploadFiles.length === 0) {
      showToast(text.alertSelectFile, "error");
      return;
    }
    // Validate file formats (BR-UC2-02 / Exc 6b)
    if (selectedUploadFiles.some((file) => !kbPreviewKind(file.name, file.type))) {
      showToast(text.alertUnsupportedFormat, "error");
      return;
    }
    // Check quota (1.0 GB limit)
    const incomingBytes = selectedUploadFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes + incomingBytes > KB_STORAGE_QUOTA_BYTES) {
      showToast(text.alertStorageQuota, "error");
      return;
    }
    const finalFolder = customUploadFolder.trim() || uploadTargetFolder;
    const form = new FormData();
    form.set("folder", finalFolder);
    selectedUploadFiles.forEach((file) => form.append("file", file));
    setIsUploadingFiles(true);
    try {
      const response = await fetch("/api/admin/files", { method: "POST", body: form });
      if (response.status === 413 || response.status === 415) {
        showToast(response.status === 413 ? text.alertStorageQuota : text.alertUnsupportedFormat, "error");
        return;
      }
      if (!response.ok) throw new Error("Upload failed");
      const result = (await response.json()) as { files: FileItem[] };
      setFiles((previous) => [...result.files, ...previous]);
      showToast(text.alertUploadSuccess, "success");
      closeFileUpload();
      setCustomUploadFolder("");
    } catch {
      showToast(text.alertUploadFailed, "error");
    } finally {
      setIsUploadingFiles(false);
    }
  };

  const handleUploadUrlSubmit = () => {
    if (!urlSourceInput.trim()) {
      showToast(text.alertEnterUrl, "error");
      return;
    }
    if (!/^https?:\/\/.+/i.test(urlSourceInput.trim())) {
      showToast(text.alertInvalidUrl, "error");
      return;
    }
    const finalFolder = urlCustomFolder.trim() || urlTargetFolder;
    let computedName = urlCustomFilename.trim();
    if (!computedName) {
      try {
        const parsed = new URL(urlSourceInput);
        computedName = parsed.pathname.split("/").filter(Boolean).pop() || "webpage_content.html";
        if (!computedName.includes(".")) computedName += ".html";
      } catch {
        computedName = "webpage_content.html";
      }
    }
    const newFile: FileItem = {
      id: Math.max(...files.map((f) => f.id), 0) + 1,
      filename: computedName,
      size: "245 KB",
      sizeBytes: 250880,
      status: "done",
      updated: new Date().toISOString().replace("T", " ").slice(0, 16),
      folder: finalFolder,
      sourceUrl: urlSourceInput.trim(),
      rawContent: text.uploadedUrlSampleContent.replace("{0}", urlSourceInput.trim()),
    };
    setFiles((prev) => [newFile, ...prev]);
    showToast(text.alertImportSuccess, "success");
    setIsUploadUrlModalOpen(false);
    setUrlSourceInput("");
    setUrlCustomFilename("");
    setUrlCustomFolder("");
  };

  const handleReprocessFile = (fileId: number) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, status: "pending" } : f))
    );
    showToast(text.alertReprocessQueued, "info");
    setTimeout(() => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: "done", updated: new Date().toISOString().replace("T", " ").slice(0, 16) }
            : f
        )
      );
    }, 1500);
  };

  const handleDeleteFileConfirm = () => {
    if (deleteFileConfirmItem) {
      setFiles((prev) =>
        prev.map((f) => (f.id === deleteFileConfirmItem.id ? { ...f, deleted: true } : f))
      );
      showToast(text.alertFileDeleted, "success");
      setDeleteFileConfirmItem(null);
    }
  };

  const handleOcrFileSelect = (file: File | undefined): boolean => {
    if (!file) return false;
    if (!isSupportedOcrFile(file.name, file.type)) {
      setOcrSelectedFile("");
      setOcrSelectedFileSize(0);
      showToast(text.alertOcrUnsupportedFormat, "error");
      return false;
    }
    if (totalBytes + file.size > KB_STORAGE_QUOTA_BYTES) {
      setOcrSelectedFile("");
      setOcrSelectedFileSize(0);
      showToast(text.alertStorageQuota, "error");
      return false;
    }
    setOcrSelectedFile(file.name);
    setOcrSelectedFileSize(file.size);
    return true;
  };

  const handleRunOcr = () => {
    if (!ocrSelectedFile) {
      showToast(text.alertSelectFile, "error");
      return;
    }
    if (totalBytes + ocrSelectedFileSize > KB_STORAGE_QUOTA_BYTES) {
      showToast(text.alertStorageQuota, "error");
      return;
    }
    setOcrStatus("running");
    setTimeout(() => {
      setOcrStatus("done");
      setOcrExtractedText(
        text.ocrSampleResult.replace("{0}", ocrSelectedFile)
      );
    }, 1200);
  };

  const handleSaveOcrToKb = () => {
    if (!ocrExtractedText.trim()) {
      showToast(text.alertEmptyOcr, "error");
      return;
    }
    const textBytes = Math.max(1024, new Blob([ocrExtractedText]).size);
    if (totalBytes + textBytes > KB_STORAGE_QUOTA_BYTES) {
      showToast(text.alertStorageQuota, "error");
      return;
    }
    const newFile: FileItem = {
      id: Math.max(...files.map((f) => f.id), 0) + 1,
      filename: ocrSelectedFile ? `OCR_${ocrSelectedFile.replace(/\.[^/.]+$/, "")}.txt` : `OCR_Extracted_${Date.now()}.txt`,
      size: formatKbFileSize(textBytes),
      sizeBytes: textBytes,
      status: ocrAutoIndex ? "done" : "not_indexed",
      updated: new Date().toISOString().replace("T", " ").slice(0, 16),
      folder: ocrTargetFolder || "ocr",
      rawContent: ocrExtractedText,
    };
    setFiles((prev) => [newFile, ...prev]);
    showToast(ocrAutoIndex ? text.alertOcrSuccess : text.alertOcrSavedNoIndex, "success");
    setKbSubTab("files");
    setOcrStatus("idle");
    setOcrExtractedText("");
    setOcrSelectedFile("");
    setOcrSelectedFileSize(0);
  };

  // 3. STANCES STATE
  const [stances, setStances] = useState<StanceItem[]>([
    {
      id: 1,
      assistantId: 1,
      name: {
        vi: "Phong cách chuẩn mực",
        en: "Standard Stance",
        ja: "基本姿勢",
        zh: "基本姿态",
      },
      version: "1.0.0",
      tone: {
        vi: "Lịch thiệp, trang trọng và chuẩn mực",
        en: "Courteous, formal and standard",
        ja: "礼儀正しく、フォーマルで標準的",
        zh: "谦逊有礼、庄重且规范",
      },
      attitude: {
        vi: "Tận tình, điềm tĩnh và chuyên nghiệp",
        en: "Supportive, calm and professional",
        ja: "親切で落ち着いたプロの対応",
        zh: "竭诚协助、沉着且专业",
      },
      lexicon: {
        vi: "Thuật ngữ chuẩn xác, câu từ gãy gọn nhã nhặn",
        en: "Standard corporate terminology, polite sentence endings",
        ja: "ビジネス専門用語と丁寧な語尾表現",
        zh: "精确的企业专业用语，言词精炼典雅",
      },
      precision: {
        vi: "Độ chính xác cao, trả lời súc tích trong 3 câu trừ khi được yêu cầu chi tiết",
        en: "High precision, concise answers under 3 sentences unless asked",
        ja: "高精度、詳細を求められない限り3文以内で簡潔に回答",
        zh: "高精度，除非要求详解否则控制在3句以内",
      },
      boundaries: {
        vi: "Chỉ trả lời dựa trên tài liệu đã xác minh; từ chối suy đoán nội dung ngoài kho tri thức",
        en: "Strictly answer within verified company documentation; refuse unsupported factual generation",
        ja: "検証済み資料に厳密に基づき回答。ナレッジベース外の憶測を拒否",
        zh: "严格依据已验证文件回答；拒绝臆测知识库以外的内容",
      },
      state: 1,
    },
  ]);

  const [stanceAssistantFilter, setStanceAssistantFilter] = useState<string>("all");
  const [isStanceModalOpen, setIsStanceModalOpen] = useState(false);
  const [editingStance, setEditingStance] = useState<StanceItem | null>(null);
  const [stanceForm, setStanceForm] = useState({
    assistantId: 1,
    name: "",
    version: "1.0.0",
    tone: "",
    attitude: "",
    lexicon: "",
    precision: "",
    boundaries: "",
    state: 1,
  });

  const handleOpenNewStance = () => {
    setEditingStance(null);
    setStanceForm({
      assistantId: assistantsList[0]?.id || 1,
      name: "",
      version: "1.0.0",
      tone: "",
      attitude: "",
      lexicon: "",
      precision: "",
      boundaries: "",
      state: 1,
    });
    setIsStanceModalOpen(true);
  };

  const handleOpenViewStance = (st: StanceItem) => {
    setEditingStance(st);
    setStanceForm({
      assistantId: st.assistantId,
      name: typeof st.name === "object" ? (st.name[lang] || Object.values(st.name)[0]) : st.name,
      version: st.version,
      tone: typeof st.tone === "object" ? (st.tone[lang] || Object.values(st.tone)[0]) : st.tone,
      attitude: typeof st.attitude === "object" ? (st.attitude[lang] || Object.values(st.attitude)[0]) : st.attitude,
      lexicon: typeof st.lexicon === "object" ? (st.lexicon[lang] || Object.values(st.lexicon)[0]) : st.lexicon,
      precision: typeof st.precision === "object" ? (st.precision[lang] || Object.values(st.precision)[0]) : st.precision,
      boundaries: typeof st.boundaries === "object" ? (st.boundaries[lang] || Object.values(st.boundaries)[0]) : st.boundaries,
      state: st.state,
    });
    setIsStanceModalOpen(true);
  };

  const handleSaveStance = () => {
    if (!stanceForm.name.trim() || !stanceForm.version.trim()) {
      showToast(text.alertReqFields, "error");
      return;
    }

    if (editingStance) {
      setStances((prev) =>
        prev.map((s) =>
          s.id === editingStance.id
            ? {
                ...s,
                assistantId: Number(stanceForm.assistantId),
                name: typeof s.name === "object" ? { ...s.name, [lang]: stanceForm.name } : stanceForm.name,
                version: stanceForm.version,
                tone: typeof s.tone === "object" ? { ...s.tone, [lang]: stanceForm.tone } : stanceForm.tone,
                attitude: typeof s.attitude === "object" ? { ...s.attitude, [lang]: stanceForm.attitude } : stanceForm.attitude,
                lexicon: typeof s.lexicon === "object" ? { ...s.lexicon, [lang]: stanceForm.lexicon } : stanceForm.lexicon,
                precision: typeof s.precision === "object" ? { ...s.precision, [lang]: stanceForm.precision } : stanceForm.precision,
                boundaries: typeof s.boundaries === "object" ? { ...s.boundaries, [lang]: stanceForm.boundaries } : stanceForm.boundaries,
                state: stanceForm.state,
              }
            : stanceForm.state === 1 && s.assistantId === Number(stanceForm.assistantId)
            ? { ...s, state: 0 }
            : s
        )
      );
      showToast(text.alertStanceUpdated, "success");
    } else {
      const newId = Math.max(...stances.map((s) => s.id), 0) + 1;
      const newStance: StanceItem = {
        id: newId,
        assistantId: Number(stanceForm.assistantId),
        name: stanceForm.name,
        version: stanceForm.version,
        tone: stanceForm.tone || text.defaultTone,
        attitude: stanceForm.attitude || text.defaultAttitude,
        lexicon: stanceForm.lexicon || text.defaultLexicon,
        precision: stanceForm.precision || text.defaultPrecision,
        boundaries: stanceForm.boundaries || text.defaultBoundaries,
        state: stanceForm.state,
      };
      setStances((prev) => [
        ...prev.map((s) => (stanceForm.state === 1 && s.assistantId === newStance.assistantId ? { ...s, state: 0 } : s)),
        newStance,
      ]);
      showToast(text.alertStanceCreated, "success");
    }
    setIsStanceModalOpen(false);
  };

  const toggleStanceStatus = (id: number) => {
    setStances((prev) =>
      prev.map((s) => (s.id === id ? { ...s, state: s.state === 1 ? 0 : 1 } : s))
    );
    showToast(text.alertStanceStatus, "success");
  };

  // 4. LEXEMES STATE
  const [lexemes, setLexemes] = useState<LexemeItem[]>([
    { id: 1, grapheme: "AIMind", type: "Phoneme", phoneme: "A-I Mind Technology", state: 1 },
    { id: 2, grapheme: "RAG", type: "Alias", phoneme: "Retrieval-Augmented Generation", state: 1 },
    { id: 3, grapheme: "DUE", type: "Phoneme", phoneme: "D-U-E University of Economics", state: 1 },
    { id: 4, grapheme: "HNSW", type: "Alias", phoneme: "Hierarchical Navigable Small World", state: 1 },
  ]);

  const [isLexemeModalOpen, setIsLexemeModalOpen] = useState(false);
  const [editingLexeme, setEditingLexeme] = useState<LexemeItem | null>(null);
  const [lexemeForm, setLexemeForm] = useState<{ grapheme: string; type: "Phoneme" | "Alias"; phoneme: string; state: number }>({
    grapheme: "",
    type: "Phoneme",
    phoneme: "",
    state: 1,
  });
  const [deleteLexemeConfirmItem, setDeleteLexemeConfirmItem] = useState<LexemeItem | null>(null);

  const handleOpenNewLexeme = () => {
    setEditingLexeme(null);
    setLexemeForm({ grapheme: "", type: "Phoneme", phoneme: "", state: 1 });
    setIsLexemeModalOpen(true);
  };

  const handleOpenEditLexeme = (lex: LexemeItem) => {
    setEditingLexeme(lex);
    setLexemeForm({
      grapheme: lex.grapheme,
      type: lex.type,
      phoneme: lex.phoneme,
      state: lex.state,
    });
    setIsLexemeModalOpen(true);
  };

  const handleSaveLexeme = () => {
    if (!lexemeForm.grapheme.trim() || !lexemeForm.phoneme.trim()) {
      showToast(text.alertReqFields, "error");
      return;
    }
    const isDuplicate = lexemes.some(
      (l) => (!editingLexeme || l.id !== editingLexeme.id) && l.grapheme.trim().toLowerCase() === lexemeForm.grapheme.trim().toLowerCase()
    );
    if (isDuplicate) {
      showToast(text.alertDuplicateLexeme, "error");
      return;
    }

    if (editingLexeme) {
      setLexemes((prev) =>
        prev.map((l) =>
          l.id === editingLexeme.id
            ? { ...l, grapheme: lexemeForm.grapheme, type: lexemeForm.type, phoneme: lexemeForm.phoneme, state: lexemeForm.state }
            : l
        )
      );
      showToast(text.alertLexemeUpdated, "success");
    } else {
      const newId = Math.max(...lexemes.map((l) => l.id), 0) + 1;
      setLexemes((prev) => [
        ...prev,
        { id: newId, grapheme: lexemeForm.grapheme, type: lexemeForm.type, phoneme: lexemeForm.phoneme, state: lexemeForm.state },
      ]);
      showToast(text.alertLexemeCreated, "success");
    }
    setIsLexemeModalOpen(false);
  };

  const toggleLexemeStatus = (id: number) => {
    setLexemes((prev) =>
      prev.map((l) => (l.id === id ? { ...l, state: l.state === 1 ? 0 : 1 } : l))
    );
    showToast(text.alertLexemeStatus, "success");
  };

  const handleDeleteLexemeConfirm = () => {
    if (deleteLexemeConfirmItem) {
      setLexemes((prev) => prev.filter((l) => l.id !== deleteLexemeConfirmItem.id));
      showToast(text.alertLexemeDeleted, "success");
      setDeleteLexemeConfirmItem(null);
    }
  };

  // 5. CHAT HISTORY STATE (grouped by sessions)
  const [chatRecords, setChatRecords] = useState<ChatRecordItem[]>([
    {
      id: 101,
      sessionId: "sess_web_78a1bc2",
      source: "WEB",
      question: "Quy định về thời gian thử việc của công ty là bao lâu?",
      answer: "Theo mục 3.2 Sổ tay Nhân viên 2026, thời gian thử việc tiêu chuẩn là 02 tháng đối với vị trí chuyên môn kỹ thuật.",
      questionAt: "2026-10-31 20:14:15",
      answerAt: "2026-10-31 20:14:17",
    },
    {
      id: 103,
      sessionId: "sess_web_78a1bc2",
      source: "WEB",
      question: "Thời gian làm việc và nghỉ lễ của công ty quy định thế nào?",
      answer: "Giờ làm việc từ 8:00 đến 17:30 từ Thứ Hai đến Thứ Sáu. Các ngày nghỉ lễ theo đúng Bộ luật Lao động hiện hành.",
      questionAt: "2026-10-31 20:16:02",
      answerAt: "2026-10-31 20:16:05",
    },
    {
      id: 102,
      sessionId: "sess_kiosk_99f2e3d",
      source: "KIOSK",
      question: "Bốn trụ cột kinh doanh cốt lõi của AI Mind Technology là gì?",
      answer: "AI Mind tập trung vào 4 trụ cột: Enterprise AI Platform, Fintech AI Solutions, Conversational & Voice AI và Computer Vision & Robotics.",
      questionAt: "2026-10-31 21:05:20",
      answerAt: "2026-10-31 21:05:23",
    },
    {
      id: 104,
      sessionId: "sess_web_45b8ca1",
      source: "WEB",
      question: "Cho tôi biết thông tin về hệ thống nhận dạng giọng nói STT?",
      answer: "Hệ thống hỗ trợ STT trực tiếp từ microphone qua WebSocket với độ trễ dưới 150ms và chuẩn lấy mẫu 16kHz.",
      questionAt: "2026-11-01 10:22:40",
      answerAt: "2026-11-01 10:22:43",
    },
  ]);

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [viewChatDetail, setViewChatDetail] = useState<ChatRecordItem | null>(null);
  const [deleteChatConfirmItem, setDeleteChatConfirmItem] = useState<ChatRecordItem | null>(null);

  const activeChatRecords = chatRecords.filter((r) => !r.deleted);

  // Group active records by sessionId
  const groupedSessions = React.useMemo(() => {
    const groups: Record<string, { sessionId: string; source: string; latestQuestion: string; latestTime: string; turns: ChatRecordItem[] }> = {};
    activeChatRecords.forEach((rec) => {
      if (!groups[rec.sessionId]) {
        groups[rec.sessionId] = {
          sessionId: rec.sessionId,
          source: rec.source,
          latestQuestion: rec.question,
          latestTime: rec.questionAt,
          turns: [],
        };
      }
      groups[rec.sessionId].turns.push(rec);
    });
    return Object.values(groups);
  }, [activeChatRecords]);

  const handleDeleteChatConfirm = () => {
    if (deleteChatConfirmItem) {
      setChatRecords((prev) =>
        prev.map((r) => (r.id === deleteChatConfirmItem.id ? { ...r, deleted: true } : r))
      );
      showToast(text.alertChatDeleted, "success");
      setDeleteChatConfirmItem(null);
      if (viewChatDetail?.id === deleteChatConfirmItem.id) setViewChatDetail(null);
    }
  };

  // 6. BACKGROUNDS STATE
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([
    {
      id: 1,
      name: "Modern Office Lobby",
      filename: "office_lobby.jpg",
      url: "/bg/office_lobby.jpg",
      active: true,
    },
    {
      id: 2,
      name: "Corporate Office",
      filename: "office.png",
      url: "/bg/office.png",
      active: false,
    },
    {
      id: 3,
      name: "Entrance",
      filename: "entrance.png",
      url: "/bg/entrance.png",
      active: false,
    },
    {
      id: 4,
      name: "Office 1",
      filename: "office_1.png",
      url: "/bg/office_1.png",
      active: false,
    },
    {
      id: 5,
      name: "Office 2",
      filename: "office_2.png",
      url: "/bg/office_2.png",
      active: false,
    },
    {
      id: 6,
      name: "Office 3",
      filename: "office_3.png",
      url: "/bg/office_3.png",
      active: false,
    },
    {
      id: 7,
      name: "Office Blur",
      filename: "office-blur.png",
      url: "/bg/office-blur.png",
      active: false,
    },
  ]);

  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const [backgroundAction, setBackgroundAction] = useState<"upload" | "activate" | "delete" | null>(null);
  const [deleteBgConfirmItem, setDeleteBgConfirmItem] = useState<BackgroundItem | null>(null);

  const handleBackgroundFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || backgroundAction) return;
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      showToast(text.alertImageSize, "error");
      return;
    }
    if (!backgroundImageMediaType(file.name)) {
      showToast(text.alertImageFormat, "error");
      return;
    }

    setBackgroundAction("upload");
    try {
      const body = new FormData();
      body.append("image", file);
      const response = await fetch("/api/admin/backgrounds", { method: "POST", body });
      if (response.status === 413 || response.status === 415) {
        showToast(response.status === 413 ? text.alertImageSize : text.alertImageFormat, "error");
        return;
      }
      if (!response.ok) throw new Error(text.alertImageUploadFailed);
      const saved: BackgroundItem = await response.json();
      setBackgrounds((prev) => [...prev, saved]);
      showToast(text.alertImageSuccess, "success");
    } catch {
      showToast(text.alertImageUploadFailed, "error");
    } finally {
      setBackgroundAction(null);
    }
  };

  const updateBackground = async (id: number, action: "activate" | "delete") => {
    if (backgroundAction) return;
    setBackgroundAction(action);
    const errorMessage = action === "delete" ? text.alertBgDeleteFailed : text.alertBgUpdateFailed;
    try {
      const response = await fetch("/api/admin/backgrounds", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error(errorMessage);
      const { backgrounds: saved }: { backgrounds: BackgroundItem[] } = await response.json();
      setBackgrounds(saved);
      if (action === "delete") {
        setDeleteBgConfirmItem(null);
        showToast(text.alertBgDeleted, "success");
      } else {
        void fetch("/api/client-settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active_background: String(id) }),
        }).catch(() => {});
        showToast(text.alertBgActiveUpdated, "success");
      }
    } catch {
      showToast(errorMessage, "error");
    } finally {
      setBackgroundAction(null);
    }
  };

  // 7. SETTINGS STATE
  const [settings, setSettings] = useState({
    locked: true,
    avatar: true,
    voice: true,
    auth: false,
    locale: "en",
    micLang: "en-US",
    translateA: "ja",
  });
  const clientBehaviorOptions = [
    { field: "locked", label: text.lockToggle, description: text.lockDesc },
    { field: "avatar", label: text.avatarToggle, description: text.avatarDesc },
    { field: "voice", label: text.voiceToggle, description: text.voiceDesc },
    { field: "auth", label: text.authToggle, description: text.authDesc },
  ] as const;
  const [savedClientLoginEnabled, setSavedClientLoginEnabled] = useState<boolean | null>(null);
  const [clientPasswordInfo, setClientPasswordInfo] = useState<{ username: string; configured: boolean } | null>(null);
  const [clientUsernameDraft, setClientUsernameDraft] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [isSavingClientPassword, setIsSavingClientPassword] = useState(false);
  const [clientPasswordSaveFailed, setClientPasswordSaveFailed] = useState(false);
  const clientPasswordDialogRef = useRef<HTMLDialogElement>(null);
  const clientUsername = clientUsernameDraft ?? clientPasswordInfo?.username ?? "wise";
  const clientPasswordStatus = clientPasswordInfo?.configured
    ? text.clientPasswordConfigured
    : savedClientLoginEnabled === false ? text.clientPasswordMissingOpen : text.clientPasswordMissing;

  const [isLoadedFromServer, setIsLoadedFromServer] = useState(false);

  // Hydrate all demo admin tables/backgrounds/chat-history from local server store on mount
  useEffect(() => {
    fetch("/api/admin/state", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.assistants)) setAssistantsList(data.assistants);
        if (Array.isArray(data.stances)) setStances(data.stances);
        if (Array.isArray(data.files)) setFiles(data.files);
        if (Array.isArray(data.lexemes)) setLexemes(data.lexemes);
        if (Array.isArray(data.chatRecords)) setChatRecords(data.chatRecords);
        if (Array.isArray(data.backgrounds)) setBackgrounds(data.backgrounds);
        if (typeof data.hasClientPassword === "boolean") {
          setClientPasswordInfo({ username: data.clientUsername ?? "wise", configured: data.hasClientPassword });
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadedFromServer(true));
  }, []);

  // Auto-persist admin demo mutations to server store (survives F5 & syncs with Client)
  useEffect(() => {
    if (!isLoadedFromServer) return;
    const timer = setTimeout(() => {
      void fetch("/api/admin/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assistants: assistantsList,
          stances,
          files,
          lexemes,
          chatRecords,
        }),
      }).catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [isLoadedFromServer, assistantsList, stances, files, lexemes, chatRecords]);

  useEffect(() => {
    fetch("/api/client-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (typeof data.auth_enabled === "boolean") setSavedClientLoginEnabled(data.auth_enabled);
        setSettings((prev) => ({
          ...prev,
          locked: typeof data.locked === "boolean" ? data.locked : prev.locked,
          avatar: typeof data.avatar_enabled === "boolean" ? data.avatar_enabled : prev.avatar,
          voice: typeof data.voice_enabled === "boolean" ? data.voice_enabled : prev.voice,
          auth: typeof data.auth_enabled === "boolean" ? data.auth_enabled : prev.auth,
          locale: data.default_locale || prev.locale,
          micLang: data.default_mic_lang || prev.micLang,
          translateA: data.default_translate_lang_a || prev.translateA,
        }));
      })
      .catch((err) => console.warn("Failed to load settings:", err));
  }, []);

  const handleSaveSettings = async () => {
    try {
      const response = await fetch("/api/client-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locked: settings.locked,
          avatar_enabled: settings.avatar,
          voice_enabled: settings.voice,
          auth_enabled: settings.auth,
          default_locale: settings.locale,
          default_mic_lang: settings.micLang,
          default_translate_lang_a: settings.translateA,
        }),
      });
      if (response.ok) setSavedClientLoginEnabled(settings.auth);
      showToast(text.alertSettingsSaved, "success");
    } catch {
      showToast(text.alertSettingsSaved, "success");
    }
  };

  const canSetClientPassword = isLoadedFromServer && !isSavingClientPassword &&
    Boolean(clientUsername.trim() && newPasswordInput.trim());

  const handleClientBehaviorToggle = (field: (typeof clientBehaviorOptions)[number]["field"]) => {
    setSettings((previous) => ({ ...previous, [field]: !previous[field] }));
    if (field === "auth" && !settings.auth) clientPasswordDialogRef.current?.showModal();
  };

  const handleSetClientPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSetClientPassword) return;

    const username = clientUsername.trim();
    setIsSavingClientPassword(true);
    setClientPasswordSaveFailed(false);
    try {
      const response = await fetch("/api/admin/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUsername: username, clientPassword: newPasswordInput.trim() }),
      });
      if (!response.ok) throw new Error("Failed to save client password");
      setClientPasswordInfo({ username, configured: true });
      clientPasswordDialogRef.current?.close();
      showToast(text.alertPasswordUpdated, "success");
    } catch {
      setClientPasswordSaveFailed(true);
    } finally {
      setIsSavingClientPassword(false);
    }
  };

  // Unique folders & filtered files for Knowledge Base
  const kbFolders = React.useMemo(
    () => Array.from(new Set(activeFiles.map((f) => f.folder))).sort(),
    [activeFiles]
  );

  const filteredFiles = activeFiles.filter((f) => {
    const matchFolder = kbFolderFilter === "all" || f.folder === kbFolderFilter;
    const matchQuery = f.filename.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchFolder && matchQuery;
  });

  // Filtered stances for Stances page
  const filteredStances = stances.filter((s) => {
    if (stanceAssistantFilter === "all") return true;
    return s.assistantId === Number(stanceAssistantFilter);
  });

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-800 font-sans overflow-hidden">
      {/* TOAST NOTIFICATION BANNER */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold animate-slideDown ${
            toastMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : toastMessage.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
        >
          {toastMessage.type === "success" && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />}
          {toastMessage.type === "error" && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
          {toastMessage.type === "info" && <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />}
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. SIDEBAR (Dark Navy matching theme) */}
      <aside className="w-64 bg-[#0B132B] text-slate-300 flex flex-col shrink-0 select-none shadow-xl">
        {/* Brand Header */}
        <div className="p-6 pb-5 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-black text-sm tracking-wider shadow-md shadow-blue-500/25">
              AI
            </div>
            <div>
              <h1 className="text-white font-bold text-base tracking-tight leading-tight">
                AI Virtual
              </h1>
              <p className="text-slate-400 text-xs font-normal tracking-wide mt-0.5">
                {text.subBrand}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {/* Dashboard */}
          <button
            onClick={() => navigateTab("dashboard")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "dashboard"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabDashboard}</span>
          </button>


          {/* Settings */}
          <button
            onClick={() => navigateTab("settings")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "settings"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabSettings}</span>
          </button>

          {/* Assistants */}
          <button
            onClick={() => navigateTab("assistants")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "assistants"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabAssistants}</span>
          </button>

          {/* Stances */}
          <button
            onClick={() => navigateTab("stances")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "stances"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabStances}</span>
          </button>

          {/* Knowledge Base */}
          <button
            onClick={() => navigateTab("knowledge-base")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "knowledge-base"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <Database className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabKnowledgeBase}</span>
          </button>

          {/* Lexemes */}
          <button
            onClick={() => navigateTab("lexemes")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "lexemes"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <BookA className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabLexemes}</span>
          </button>

          {/* Chat History */}
          <button
            onClick={() => navigateTab("chat-history")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "chat-history"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabChatHistory}</span>
          </button>

          {/* Backgrounds */}
          <button
            onClick={() => navigateTab("backgrounds")}
            className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === "backgrounds"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{text.tabBackgrounds}</span>
          </button>
        </nav>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
          AI Virtual Assistant System
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* TOPBAR */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between shrink-0 shadow-xs">
          <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span>{text.admin}</span>
            <span className="text-slate-300">/</span>
            <span className="text-blue-600">{getTabLabel(activeTab)}</span>
          </div>

          <div className="flex items-center gap-5">
            {/* Language Switcher: VI, EN, JP, ZH */}
            <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-full border border-slate-200/60">
              <button
                onClick={() => selectLang("vi")}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                  lang === "vi"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                VI
              </button>
              <button
                onClick={() => selectLang("en")}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                  lang === "en"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                EN
              </button>
              <button
                onClick={() => selectLang("ja")}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                  lang === "ja"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                JP
              </button>
              <button
                onClick={() => selectLang("zh")}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                  lang === "zh"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                ZH
              </button>
            </div>

            {/* Logout button */}
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              <span>{text.logout}</span>
            </button>
          </div>
        </header>

        {/* WORKSPACE CONTENT AREA */}
        <main className={`min-h-0 flex-1 overflow-y-auto ${isSettingsTab ? "py-4" : "py-6"} ${workspacePadding}`}>
          {/* TAB: DASHBOARD */}
          {activeTab === "dashboard" && (
            <div className="w-full space-y-8 animate-fadeIn">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {text.dashboardTitle}
                </h2>
                <p className="text-sm text-slate-500 mt-1">{text.welcome}</p>
              </div>

              {/* 4 STATS CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-xl border border-slate-200/70 p-7 shadow-xs hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-sm font-semibold tracking-tight">{text.assistants}</span>
                    <Bot className="w-5 h-5 text-blue-500 stroke-[1.75]" />
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-extrabold text-slate-900">{assistantsList.filter((assistant) => assistant.state === 1).length}</div>
                    <div className="text-xs text-slate-400 mt-1">{text.activeAssistants}</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200/70 p-7 shadow-xs hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-sm font-semibold tracking-tight">{text.chatSessions}</span>
                    <MessageSquare className="w-5 h-5 text-indigo-500 stroke-[1.75]" />
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-extrabold text-slate-900">{groupedSessions.length}</div>
                    <div className="text-xs text-slate-400 mt-1">{text.totalConversations}</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200/70 p-7 shadow-xs hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-sm font-semibold tracking-tight">{text.kbDocuments}</span>
                    <Database className="w-5 h-5 text-emerald-500 stroke-[1.75]" />
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-extrabold text-slate-900">{activeFiles.length}</div>
                    <div className="text-xs text-slate-400 mt-1">{text.uploadedFiles}</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200/70 p-7 shadow-xs hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-sm font-semibold tracking-tight">{text.ragChunks}</span>
                    <Layers className="w-5 h-5 text-purple-500 stroke-[1.75]" />
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-extrabold text-slate-900">{activeFiles.filter((f) => f.status === "done").length * 48}</div>
                    <div className="text-xs text-slate-400 mt-1">{text.vectorPoints}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ASSISTANTS */}
          {activeTab === "assistants" && (
            <div className="w-full space-y-6 animate-fadeIn">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                    {text.assistantsTitle}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {text.assistantsSubtitle}
                  </p>
                </div>
                <button
                  onClick={handleOpenNewAssistant}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0B132B] hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{text.newAssistant}</span>
                </button>
              </div>

              {/* Table Card */}
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-x-auto">
                {assistantsList.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-400">{text.emptyAssistants}</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-100 text-slate-500 font-medium text-sm bg-slate-50/50">
                      <tr>
                        <th className="py-4 px-6 whitespace-nowrap w-20">{text.thId}</th>
                        <th className="py-4 px-6 whitespace-nowrap">{text.thName}</th>
                        <th className="py-4 px-6 whitespace-nowrap">{text.thVersion}</th>
                        <th className="py-4 px-6 whitespace-nowrap">{text.thState}</th>
                        <th className="py-4 px-6 whitespace-nowrap text-right">{text.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/80 text-slate-700">
                      {assistantsList.map((ast) => (
                        <tr
                          key={ast.id}
                          className="hover:bg-slate-50/60 transition-colors"
                        >
                          <td className="py-5 px-6 font-medium text-slate-500 whitespace-nowrap">
                            {ast.id}
                          </td>
                          <td className="py-5 px-6 font-medium text-slate-800">
                            {ast.name[lang] || Object.values(ast.name)[0]}
                          </td>
                          <td className="py-5 px-6 text-slate-500 font-mono whitespace-nowrap">
                            {ast.version}
                          </td>
                          <td className="py-5 px-6 whitespace-nowrap">
                            {ast.state === 1 ? (
                              <span className="inline-flex items-center whitespace-nowrap px-3.5 py-1 rounded-full bg-emerald-100/70 text-emerald-700 font-semibold text-xs border border-emerald-200/60">
                                {text.badgeActive}
                              </span>
                            ) : (
                              <span className="inline-flex items-center whitespace-nowrap px-3.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-xs">
                                {text.badgeInactive}
                              </span>
                            )}
                          </td>
                          <td className="py-5 px-6 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2.5">
                              <button
                                onClick={() => handleOpenEditAssistant(ast)}
                                className="px-4 py-1.5 whitespace-nowrap bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium transition-colors shadow-2xs cursor-pointer"
                              >
                                {text.btnEdit}
                              </button>
                              <button
                                onClick={() => {
                                  setStanceAssistantFilter(String(ast.id));
                                  navigateTab("stances");
                                }}
                                className="px-4 py-1.5 whitespace-nowrap bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium transition-colors shadow-2xs cursor-pointer"
                              >
                                {text.btnStances}
                              </button>
                              <button
                                onClick={() => setDeleteAssistantConfirmId(ast.id)}
                                className="px-4 py-1.5 whitespace-nowrap bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-2xs cursor-pointer"
                              >
                                {text.btnDelete}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB: KNOWLEDGE BASE */}
          {activeTab === "knowledge-base" && (
            <div className="w-full space-y-3.5 animate-fadeIn">
              {/* Header + compact sub-tab switcher + upload buttons in one row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">{text.kbTitle}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{text.kbSubtitle}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() => setKbSubTab(kbSubTab === "ocr" ? "files" : "ocr")}
                    className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shadow-2xs ${
                      kbSubTab === "ocr"
                        ? "bg-[#0B132B] text-white border-[#0B132B]"
                        : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <ScanText className="w-3.5 h-3.5" />
                    <span>{text.tabKbOcr}</span>
                  </button>
                  <button
                    onClick={() => setIsUploadFileModalOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 text-slate-900 text-xs font-semibold rounded-lg hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{text.uploadFile}</span>
                  </button>
                  <button
                    onClick={() => setIsUploadUrlModalOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 text-slate-900 text-xs font-semibold rounded-lg hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{text.uploadUrl}</span>
                  </button>
                </div>
              </div>

              {/* Storage Usage Progress Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {text.quotaUsagePrefix}
                    {quotaMb} MB / 1.0 GB
                  </span>
                  <span>{totalBytes === 0 ? 0 : Math.max(1, Math.round(Number(quotaPercentage)))}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0B132B] rounded-full transition-all"
                    style={{ width: `${totalBytes === 0 ? 0 : Math.max(2, Math.min(100, Number(quotaPercentage)))}%` }}
                  />
                </div>
              </div>

              {kbSubTab === "files" ? (
                <div className="space-y-2.5">
                  {/* Folder Filter + Search Box Row */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <div className="relative shrink-0">
                      <select
                        value={kbFolderFilter}
                        onChange={(e) => setKbFolderFilter(e.target.value)}
                        className="appearance-none w-full sm:w-44 bg-white border border-slate-300 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-800 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 cursor-pointer"
                      >
                        <option value="all">{text.allFolders}</option>
                        {kbFolders.map((folder) => (
                          <option key={folder} value={folder}>
                            {folder}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder={text.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-9 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 shadow-2xs"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Total & Showing Range Row */}
                  <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
                    <span>
                      {filteredFiles.length} {text.filesTotalSuffix}
                    </span>
                    <span>
                      {filteredFiles.length === 0
                        ? text.showingRange.replace("{0}", "0").replace("{1}", "0").replace("{2}", "0")
                        : text.showingRange
                            .replace("{0}", "1")
                            .replace("{1}", String(filteredFiles.length))
                            .replace("{2}", String(filteredFiles.length))}
                    </span>
                  </div>

                  {/* Files Table */}
                  <div className="bg-white rounded-xl border border-slate-200/80 overflow-x-auto shadow-xs">
                    {activeFiles.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-400">{text.emptyFiles}</div>
                    ) : filteredFiles.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-400">{text.noMatchFiles}</div>
                    ) : (
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-sm">
                          <tr>
                            <th className="py-3.5 px-6 whitespace-nowrap">{text.thFileName}</th>
                            <th className="py-3.5 px-6 whitespace-nowrap w-28">{text.thFileSize}</th>
                            <th className="py-3.5 px-6 whitespace-nowrap w-44">{text.thUpdated}</th>
                            <th className="py-3.5 px-6 whitespace-nowrap w-32">{text.thStatus}</th>
                            <th className="py-3.5 px-6 whitespace-nowrap w-48">{text.thActions}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {filteredFiles.map((file) => (
                            <tr key={file.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-4 px-6">
                                <div className="flex items-start gap-2.5">
                                  <FileText className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-700 text-sm leading-snug">
                                      {file.filename}
                                    </div>
                                    <div className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-xl">
                                      {file.folder}/{file.filename}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-4 px-6 text-slate-600 whitespace-nowrap">{file.size}</td>
                              <td className="py-4 px-6 text-slate-600 whitespace-nowrap">{file.updated}</td>
                              <td className="py-4 px-6 whitespace-nowrap">
                                {file.status === "done" && (
                                  <span className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium text-xs">
                                    {text.statusDone}
                                  </span>
                                )}
                                {file.status === "pending" && (
                                  <span className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full bg-amber-50 text-amber-700 font-medium text-xs animate-pulse">
                                    {text.statusPending}
                                  </span>
                                )}
                                {file.status === "processing" && (
                                  <span className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-medium text-xs animate-pulse">
                                    {text.statusProcessing}
                                  </span>
                                )}
                                {file.status === "failed" && (
                                  <span className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full bg-rose-50 text-rose-700 font-medium text-xs">
                                    {text.statusFailed}
                                  </span>
                                )}
                                {file.status === "not_indexed" && (
                                  <span className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-xs">
                                    {text.statusNotIndexed}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-6 whitespace-nowrap">
                                <div className="inline-flex flex-col gap-1.5 items-start">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      title={text.btnPreview}
                                      onClick={() => setPreviewFileItem(file)}
                                      className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    <a
                                      href={kbSourceLink(file.sourceUrl) ?? kbOriginalUrl(file)}
                                      download={file.sourceUrl ? undefined : file.filename}
                                      target={file.sourceUrl ? "_blank" : undefined}
                                      rel="noreferrer"
                                      className="px-3 py-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shadow-2xs"
                                    >
                                      {file.sourceUrl ? text.btnOpenLink : text.btnDownload}
                                    </a>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleReprocessFile(file.id)}
                                      className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-600 border border-blue-200 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shadow-2xs"
                                    >
                                      {text.btnReprocess}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteFileConfirmItem(file)}
                                      className="px-3 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shadow-2xs"
                                    >
                                      {text.btnDelete}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ) : (
                /* OCR UPLOAD SECTION (UC 2.9) */
                <div className="bg-white rounded-xl border border-slate-200/80 p-8 shadow-xs space-y-6">
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg">{text.ocrTitle}</h3>
                    <p className="text-sm text-slate-500 mt-1">{text.ocrSubtitle}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                        {text.ocrSelectFile} *
                      </label>
                      <div className="flex items-center gap-3 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white">
                        <label className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer shrink-0 transition-colors whitespace-nowrap">
                          {text.ocrSelectFilesBtn}
                          <input
                            type="file"
                            accept="image/*,.pdf,.html,.txt"
                            onChange={(e) => {
                              const ok = handleOcrFileSelect(e.target.files?.[0]);
                              if (!ok) e.target.value = "";
                            }}
                            className="hidden"
                          />
                        </label>
                        <span className="text-xs text-slate-500 truncate">
                          {ocrSelectedFile || text.noFileChosen}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                        {text.targetKbFolder}
                      </label>
                      <input
                        type="text"
                        value={ocrTargetFolder}
                        onChange={(e) => setOcrTargetFolder(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ocrAutoIndex}
                        onChange={(e) => setOcrAutoIndex(e.target.checked)}
                        className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                      />
                      <span>{text.autoIndexQdrant}</span>
                    </label>

                    <button
                      onClick={handleRunOcr}
                      disabled={ocrStatus === "running"}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-xs"
                    >
                      {ocrStatus === "running" ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>{text.ocrStatusRunning}</span>
                        </>
                      ) : (
                        <>
                          <ScanText className="w-4 h-4" />
                          <span>{text.btnRunOcr}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {ocrStatus === "done" && (
                    <div className="space-y-3 animate-fadeIn">
                      <div className="flex items-center justify-between text-sm font-semibold text-emerald-700 bg-emerald-50 px-4 py-2.5 rounded-lg border border-emerald-200">
                        <span>{text.ocrStatusDone}</span>
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                      <textarea
                        rows={8}
                        value={ocrExtractedText}
                        onChange={(e) => setOcrExtractedText(e.target.value)}
                        className="w-full p-4 font-sans text-sm bg-slate-900 text-slate-100 rounded-lg border border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 leading-relaxed"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={handleSaveOcrToKb}
                          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 shadow-sm cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>{text.btnSaveToKb}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: STANCES */}
          {activeTab === "stances" && (
            <div className="w-full space-y-6 animate-fadeIn">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{text.stancesTitle}</h2>
                  <p className="text-sm text-slate-500 mt-1">{text.stancesSubtitle}</p>
                </div>
                <button
                  onClick={handleOpenNewStance}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0B132B] hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{text.newStance}</span>
                </button>
              </div>

              {/* Filter by Assistant */}
              <div className="flex items-center">
                <div className="relative">
                  <select
                    value={stanceAssistantFilter}
                    onChange={(e) => setStanceAssistantFilter(e.target.value)}
                    className="appearance-none bg-white border border-slate-200 rounded-lg px-4 py-2.5 pr-10 text-sm font-normal text-slate-700 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300 cursor-pointer min-w-[260px]"
                  >
                    <option value="all">{text.allAssistants}</option>
                    {assistantsList.map((ast) => (
                      <option key={ast.id} value={ast.id}>
                        {getVal(ast.name) || Object.values(ast.name)[0]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Stances Table */}
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 font-medium text-sm bg-slate-50/50">
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm whitespace-nowrap">{text.thAssistant}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm whitespace-nowrap">{text.thStanceId}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm whitespace-nowrap">{text.thStanceName}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm whitespace-nowrap">{text.thVersion}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm whitespace-nowrap">{text.thState}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm text-center whitespace-nowrap">{text.thActive}</th>
                      <th className="py-4 px-6 font-medium text-slate-500 text-sm text-center whitespace-nowrap">{text.thActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/80 text-sm">
                    {filteredStances.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                          {text.emptyStances}
                        </td>
                      </tr>
                    ) : (
                      filteredStances.map((st) => {
                        const matchedAssistant = assistantsList.find((a) => a.id === st.assistantId);
                        const assistantName = matchedAssistant
                          ? getVal(matchedAssistant.name) || Object.values(matchedAssistant.name)[0]
                          : `${text.thAssistant} #${st.assistantId}`;
                        const stanceName = getVal(st.name) || Object.values(st.name)[0];

                        return (
                          <tr key={st.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-5 px-6 text-slate-800 font-normal">
                              {assistantName}
                            </td>
                            <td className="py-5 px-6 text-slate-700 font-normal whitespace-nowrap">
                              {st.id}
                            </td>
                            <td className="py-5 px-6 text-slate-800 font-normal whitespace-nowrap">
                              {stanceName}
                            </td>
                            <td className="py-5 px-6 text-slate-700 font-mono font-normal whitespace-nowrap">
                              {st.version}
                            </td>
                            <td className="py-5 px-6 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center whitespace-nowrap px-3.5 py-1 rounded-full text-xs font-medium ${
                                  st.state === 1
                                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100/60"
                                    : "bg-slate-100 text-slate-500 border border-slate-200"
                                }`}
                              >
                                {st.state === 1 ? text.badgeActive : text.badgeInactive}
                              </span>
                            </td>
                            <td className="py-5 px-6 text-center whitespace-nowrap">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={st.state === 1}
                                onClick={() => toggleStanceStatus(st.id)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  st.state === 1 ? "bg-[#0B132B]" : "bg-slate-300"
                                }`}
                                title={st.state === 1 ? text.badgeInactive : text.badgeActive}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    st.state === 1 ? "translate-x-5" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </td>
                            <td className="py-5 px-6 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleOpenViewStance(st)}
                                className="px-4 py-1.5 whitespace-nowrap bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium shadow-2xs transition-colors cursor-pointer"
                              >
                                {text.btnView}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: LEXEMES */}
          {activeTab === "lexemes" && (
            <div className="w-full space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{text.lexemesTitle}</h2>
                  <p className="text-sm text-slate-500 mt-1">{text.lexemesSubtitle}</p>
                </div>
                <button
                  onClick={handleOpenNewLexeme}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0B132B] hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{text.newLexeme}</span>
                </button>
              </div>

              <div className="bg-white rounded-xl border border-slate-200/80 overflow-x-auto shadow-xs">
                {lexemes.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-400">{text.emptyLexemes}</div>
                ) : (
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="border-b border-slate-100 text-slate-500 font-medium text-sm bg-white">
                      <tr>
                        <th className="py-4 px-6 w-20 font-medium whitespace-nowrap">{text.thId}</th>
                        <th className="py-4 px-6 w-64 font-medium whitespace-nowrap">{text.thGrapheme}</th>
                        <th className="py-4 px-6 w-36 font-medium whitespace-nowrap">{text.thType}</th>
                        <th className="py-4 px-6 font-medium whitespace-nowrap">{text.thReading}</th>
                        <th className="py-4 px-6 w-32 text-center font-medium whitespace-nowrap">{text.thActive}</th>
                        <th className="py-4 px-6 w-48 font-medium whitespace-nowrap">{text.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/80 text-slate-700">
                      {lexemes.map((lex) => (
                        <tr key={lex.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-5 px-6 text-slate-600">{lex.id}</td>
                          <td className="py-5 px-6 font-semibold text-slate-900">{lex.grapheme}</td>
                          <td className="py-5 px-6">
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
                              {lex.type === "Phoneme" ? text.typePhoneme : text.typeAlias}
                            </span>
                          </td>
                          <td className="py-5 px-6 text-slate-700">{lex.phoneme}</td>
                          <td className="py-5 px-6 text-center">
                            {/* Dark toggle switch matching template */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={lex.state === 1}
                              onClick={() => toggleLexemeStatus(lex.id)}
                              title={lex.state === 1 ? text.badgeActive : text.badgeInactive}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                lex.state === 1 ? "bg-[#0B132B]" : "bg-slate-300"
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                  lex.state === 1 ? "translate-x-5" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </td>
                          <td className="py-5 px-6 whitespace-nowrap">
                            <div className="inline-flex items-center gap-2.5">
                              <button
                                onClick={() => handleOpenEditLexeme(lex)}
                                className="px-4 py-1.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-lg text-sm font-medium shadow-2xs transition-colors cursor-pointer"
                              >
                                {text.btnEdit}
                              </button>
                              <button
                                onClick={() => setDeleteLexemeConfirmItem(lex)}
                                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold shadow-2xs transition-colors cursor-pointer"
                              >
                                {text.btnDelete}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB: CHAT HISTORY (UC 6.1 & 6.2) */}
          {activeTab === "chat-history" && (
            <div className="w-full space-y-6 animate-fadeIn">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {text.chatHistoryTitle}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {text.chatHistorySubtitle}
                </p>
              </div>

              {groupedSessions.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-sm text-slate-400 shadow-xs">
                  {text.emptyChatHistory}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Sessions Overview Table */}
                  <div className="chat-history-table-frame overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
                    <table role="table" className="chat-history-table w-full table-fixed border-collapse text-left text-sm">
                      <thead role="rowgroup" className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
                        <tr role="row">
                          <th role="columnheader" scope="col" className="w-36 px-3 py-4">{text.thSession}</th>
                          <th role="columnheader" scope="col" className="w-[12%] px-3 py-4">{text.thSource}</th>
                          <th role="columnheader" scope="col" className="px-3 py-4">{text.thQuestion}</th>
                          <th role="columnheader" scope="col" className="w-[18%] px-3 py-4">{text.thQuestionTime}</th>
                          <th role="columnheader" scope="col" className="w-40 px-3 py-4">{text.thActions}</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup" className="divide-y divide-slate-100 text-slate-700">
                        {groupedSessions.map((session) => {
                          const isExpanded = expandedSessionId === session.sessionId;
                          const shortSessionId = session.sessionId.length > 8
                            ? `${session.sessionId.slice(0, 8)}…`
                            : session.sessionId;
                          return (
                            <React.Fragment key={session.sessionId}>
                              <tr
                                role="row"
                                onClick={() =>
                                  setExpandedSessionId(isExpanded ? null : session.sessionId)
                                }
                                className={`hover:bg-slate-50/70 transition-colors cursor-pointer ${
                                  isExpanded ? "bg-blue-50/40" : ""
                                }`}
                              >
                                <td role="cell" className="px-3 py-4">
                                  <div className="flex min-w-0 items-center gap-2 font-mono font-semibold text-blue-600">
                                    <ChevronRight
                                      className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${
                                        isExpanded ? "rotate-90 text-blue-600" : ""
                                      }`}
                                    />
                                    <span className="truncate" title={session.sessionId}>
                                      {shortSessionId}
                                    </span>
                                  </div>
                                </td>
                                <td role="cell" className="px-3 py-4">
                                  <span className="inline-block max-w-full truncate rounded bg-slate-100 px-2 py-1 align-middle text-xs font-bold uppercase text-slate-600" title={session.source}>
                                    {session.source}
                                  </span>
                                </td>
                                <td role="cell" className="px-3 py-4 font-medium text-slate-800">
                                  <p className="line-clamp-2 [overflow-wrap:anywhere]" title={session.latestQuestion}>
                                    {session.latestQuestion}
                                  </p>
                                </td>
                                <td role="cell" className="px-3 py-4 font-mono text-xs text-slate-400 [overflow-wrap:anywhere]">
                                  {session.latestTime}
                                </td>
                                <td role="cell" className="px-3 py-4" />
                              </tr>

                              {/* Expanded Session Turns (aligned directly with table columns) */}
                              {isExpanded &&
                                session.turns.map((record, idx) => (
                                  <tr
                                    key={record.id}
                                    role="row"
                                    className="bg-slate-50/60 hover:bg-slate-100/60 transition-colors"
                                  >
                                    <td role="cell" className="py-4 pl-9 pr-3 font-mono text-xs text-slate-500">
                                      #{idx + 1}
                                    </td>
                                    <td role="cell" className="px-3 py-4">
                                      <span className="inline-block max-w-full truncate rounded border border-slate-200 bg-white px-2 py-0.5 align-middle text-xs font-semibold uppercase text-slate-600" title={record.source}>
                                        {record.source}
                                      </span>
                                    </td>
                                    <td role="cell" className="px-3 py-4 text-slate-800 [overflow-wrap:anywhere]">
                                      {record.question}
                                    </td>
                                    <td role="cell" className="px-3 py-4 font-mono text-xs text-slate-400 [overflow-wrap:anywhere]">
                                      {record.questionAt}
                                    </td>
                                    <td role="cell" className="px-3 py-4">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setViewChatDetail(record);
                                          }}
                                          className="max-w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-2xs transition-colors [overflow-wrap:anywhere] hover:bg-slate-50"
                                        >
                                          {text.btnView}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDeleteChatConfirmItem(record);
                                          }}
                                          className="max-w-full cursor-pointer rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white shadow-2xs transition-colors [overflow-wrap:anywhere] hover:bg-red-600"
                                        >
                                          {text.btnDelete}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: BACKGROUNDS (UC 8.1 & 8.2) */}
          {activeTab === "backgrounds" && (
            <div className="w-full space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{text.backgroundsTitle}</h2>
                  <p className="text-sm text-slate-500 mt-1">{text.backgroundsSubtitle}</p>
                </div>
                <input
                  ref={backgroundInputRef}
                  type="file"
                  accept={BACKGROUND_IMAGE_ACCEPT}
                  onChange={handleBackgroundFileChange}
                  hidden
                />
                <button
                  type="button"
                  onClick={() => backgroundInputRef.current?.click()}
                  disabled={!isLoadedFromServer || backgroundAction !== null}
                  aria-busy={backgroundAction === "upload"}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0B132B] hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {backgroundAction === "upload" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span aria-live="polite">{backgroundAction === "upload" ? text.uploadingImage : text.uploadImage}</span>
                </button>
              </div>

              {backgrounds.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400 bg-white rounded-xl border border-slate-200/80">
                  {text.emptyBackgrounds}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {backgrounds.map((bg) => (
                    <div
                      key={bg.id}
                      className={`bg-white rounded-xl overflow-hidden border transition-all flex flex-col ${
                        bg.active
                          ? "border-2 border-emerald-500 shadow-md ring-2 ring-emerald-500/15"
                          : "border-slate-200/90 hover:border-slate-300 shadow-xs"
                      }`}
                    >
                      <div className="aspect-[16/10] w-full bg-slate-100 relative overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bg.url}
                          alt={bg.filename}
                          className="w-full h-full object-cover"
                        />
                        {bg.active && (
                          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 rounded-full bg-emerald-600/95 text-white text-xs font-semibold shadow-sm">
                            <Check className="w-3.5 h-3.5" />
                            <span>{text.badgeCurrentActive}</span>
                          </span>
                        )}
                      </div>
                      <div className="p-3.5 space-y-3 bg-white flex-1 flex flex-col justify-between">
                        <p
                          className="text-xs text-slate-600 truncate"
                          title={bg.filename}
                        >
                          {bg.filename}
                        </p>
                        <div className="flex items-center gap-2.5">
                          {!bg.active ? (
                            <button
                              type="button"
                              onClick={() => void updateBackground(bg.id, "activate")}
                              disabled={!isLoadedFromServer || backgroundAction !== null}
                              className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-2xs disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {text.btnSetActive}
                            </button>
                          ) : (
                            <div className="flex-1 py-2 px-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <Check className="w-4 h-4 shrink-0" />
                              <span>{text.badgeCurrentActive}</span>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeleteBgConfirmItem(bg)}
                            disabled={!isLoadedFromServer || backgroundAction !== null}
                            className="h-9 w-9 shrink-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors cursor-pointer shadow-2xs disabled:cursor-not-allowed disabled:opacity-60"
                            title={text.btnDelete}
                            aria-label={text.btnDelete}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: SETTINGS (UC 9) */}
          {isSettingsTab && (
            <div className="flex min-h-[min(100%,42rem)] w-full flex-col gap-3 animate-fadeIn font-sans text-base font-normal leading-6 text-slate-900 [container-type:inline-size]">
              <div>
                <h2 className="text-2xl font-bold leading-8 tracking-tight">{text.settingsTitle}</h2>
                <p className={`mt-1 ${settingsDescriptionClassName}`}>{text.settingsSubtitle}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 [@container(min-width:60rem)]:grow [@container(min-width:60rem)]:grid-cols-2">
                {/* SECTION 1: Client Behavior */}
                <section className={`flex flex-col ${settingsCardClassName}`} aria-labelledby="client-behavior-title">
                  <h3 id="client-behavior-title" className={settingsSectionTitleClassName}>
                    {text.clientBehaviorSection}
                  </h3>
                  <div className="mt-2 flex grow flex-col">
                    {clientBehaviorOptions.map(({ field, label, description }) => (
                      <div key={field} className="flex min-h-[4.5rem] grow items-center justify-between gap-3 border-b border-slate-200 py-2.5 last:border-b-0">
                        <div className="min-w-0">
                          <h4 id={`client-behavior-${field}-label`} className="font-semibold">
                            {label}
                          </h4>
                          <p id={`client-behavior-${field}-description`} className={`mt-1 ${settingsDescriptionClassName}`}>
                            {description}
                          </p>
                          {field === "auth" && settings.auth && (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => clientPasswordDialogRef.current?.showModal()}
                              className="mt-1 cursor-pointer text-sm font-semibold text-blue-700 hover:underline"
                            >
                              {text.btnManageClientPassword}
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings[field]}
                          aria-labelledby={`client-behavior-${field}-label`}
                          aria-describedby={`client-behavior-${field}-description`}
                          onClick={() => handleClientBehaviorToggle(field)}
                          className={`inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                            settings[field] ? "bg-slate-900" : "bg-slate-300"
                          }`}
                        >
                          <span aria-hidden="true" className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                            settings[field] ? "translate-x-5" : "translate-x-0"
                          }`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* SECTION 2: Default Languages (UC 9 Alt 3a1) */}
                <section className={`flex flex-col ${settingsCardClassName}`} aria-labelledby="default-languages-title">
                  <h3 id="default-languages-title" className={settingsSectionTitleClassName}>
                    {text.defaultLangSection}
                  </h3>

                  <div className="mt-3 flex grow flex-col gap-3">
                    <div className="flex grow flex-col justify-center">
                      <label htmlFor="default-ui-language" className="mb-1 block font-semibold">
                        {text.defaultUiLang}
                      </label>
                      <select
                        id="default-ui-language"
                        aria-describedby="default-ui-language-description"
                        value={settings.locale}
                        onChange={(e) => setSettings({ ...settings, locale: e.target.value })}
                        className={`cursor-pointer ${settingsControlClassName}`}
                      >
                        <option value="en">{text.langEn}</option>
                        <option value="vi">{text.langVi}</option>
                        <option value="ja">{text.langJa}</option>
                        <option value="zh-TW">{text.langZh}</option>
                      </select>
                      <p id="default-ui-language-description" className={`mt-1.5 ${settingsDescriptionClassName}`}>{text.defaultUiLangDesc}</p>
                    </div>

                    <div className="flex grow flex-col justify-center">
                      <label htmlFor="default-mic-language" className="mb-1 block font-semibold">
                        {text.defaultMicLang}
                      </label>
                      <select
                        id="default-mic-language"
                        aria-describedby="default-mic-language-description"
                        value={settings.micLang}
                        onChange={(e) => setSettings({ ...settings, micLang: e.target.value })}
                        className={`cursor-pointer ${settingsControlClassName}`}
                      >
                        <option value="en-US">{text.micLangEn}</option>
                        <option value="vi-VN">{text.micLangVi}</option>
                        <option value="ja-JP">{text.micLangJa}</option>
                        <option value="zh-CN">{text.micLangZh}</option>
                      </select>
                      <p id="default-mic-language-description" className={`mt-1.5 ${settingsDescriptionClassName}`}>{text.defaultMicLangDesc}</p>
                    </div>

                    <div className="flex grow flex-col justify-center">
                      <label htmlFor="default-translate-language" className="mb-1 block font-semibold">
                        {text.defaultTranslateA}
                      </label>
                      <select
                        id="default-translate-language"
                        aria-describedby="default-translate-language-description"
                        value={settings.translateA}
                        onChange={(e) => setSettings({ ...settings, translateA: e.target.value })}
                        className={`cursor-pointer ${settingsControlClassName}`}
                      >
                        <option value="ja">{text.langJa}</option>
                        <option value="en">{text.langEn}</option>
                        <option value="vi">{text.langVi}</option>
                        <option value="zh">{text.langZh}</option>
                      </select>
                      <p id="default-translate-language-description" className={`mt-1.5 ${settingsDescriptionClassName}`}>{text.defaultTranslateDesc}</p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="flex shrink-0 justify-end">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="cursor-pointer rounded-lg bg-blue-600 px-6 py-2 font-semibold leading-6 text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700"
                >
                  {text.btnSaveSettings}
                </button>
              </div>
            </div>
          )}
        </main>

        {isSettingsTab && (
          <dialog
            ref={clientPasswordDialogRef}
            aria-labelledby="client-password-title"
            aria-describedby="client-password-description"
            onCancel={(event) => {
              if (isSavingClientPassword) event.preventDefault();
            }}
            onClose={() => {
              setClientUsernameDraft(null);
              setNewPasswordInput("");
              setClientPasswordSaveFailed(false);
            }}
            className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 font-sans text-base leading-6 text-slate-900 shadow-2xl backdrop:bg-slate-900/40"
          >
            <form onSubmit={handleSetClientPassword} aria-busy={isSavingClientPassword} className="flex max-h-[calc(100dvh-2rem)] flex-col">
              <header className="shrink-0 border-b border-slate-200 px-5 py-4">
                <h3 id="client-password-title" className={settingsSectionTitleClassName}>
                  {text.clientPasswordSection}
                </h3>
              </header>
              <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
                <div>
                  <p id="client-password-description" className={settingsDescriptionClassName}>{text.clientPasswordDesc}</p>
                  {clientPasswordInfo && (
                    <p role="status" className="mt-1 text-sm font-medium leading-5 text-slate-700">{clientPasswordStatus}</p>
                  )}
                </div>
                <label className="block font-semibold">
                  {text.clientUsernameLabel}
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={clientUsername}
                    disabled={isSavingClientPassword}
                    onChange={(e) => setClientUsernameDraft(e.target.value)}
                    className={`mt-1 ${settingsControlClassName}`}
                  />
                </label>
                <label className="block font-semibold">
                  {text.newPasswordLabel}
                  <input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    placeholder={text.newPasswordPlaceholder}
                    value={newPasswordInput}
                    disabled={isSavingClientPassword}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    className={`mt-1 placeholder:text-slate-500 ${settingsControlClassName}`}
                  />
                </label>
                {clientPasswordSaveFailed && (
                  <p role="alert" className="text-sm text-rose-700">{text.alertPasswordUpdateFailed}</p>
                )}
              </div>
              <footer className="flex shrink-0 justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3">
                <button
                  type="button"
                  onClick={() => clientPasswordDialogRef.current?.close()}
                  disabled={isSavingClientPassword}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold enabled:cursor-pointer enabled:hover:bg-slate-50 disabled:opacity-50"
                >
                  {text.btnCancel}
                </button>
                <button
                  type="submit"
                  disabled={!canSetClientPassword}
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white enabled:cursor-pointer enabled:hover:bg-slate-800 disabled:bg-slate-500"
                >
                  {text.btnSetPassword}
                </button>
              </footer>
            </form>
          </dialog>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODALS SECTION */}
      {/* ========================================================================= */}

      {/* MODAL 1: CREATE / EDIT ASSISTANT (UC 1.1 & 1.3) */}
      {isAssistantModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">
                {editingAssistant ? text.btnEdit : text.newAssistant}
              </h3>
              <button
                onClick={() => setIsAssistantModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.assistantNameLabel} *
                </label>
                <input
                  type="text"
                  value={assistantForm.name}
                  onChange={(e) =>
                    setAssistantForm({ ...assistantForm, name: e.target.value })
                  }
                  placeholder={text.phAssistantName}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    {text.versionLabel} *
                  </label>
                  <input
                    type="text"
                    value={assistantForm.version}
                    onChange={(e) =>
                      setAssistantForm({ ...assistantForm, version: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    {text.stateLabel}
                  </label>
                  <select
                    value={assistantForm.state}
                    onChange={(e) =>
                      setAssistantForm({
                        ...assistantForm,
                        state: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={0}>{text.badgeInactive}</option>
                    <option value={1}>{text.badgeActive}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.personaJsonLabel}
                </label>
                <textarea
                  rows={6}
                  value={assistantForm.personaText}
                  onChange={(e) =>
                    setAssistantForm({ ...assistantForm, personaText: e.target.value })
                  }
                  className="w-full p-3 font-mono text-xs bg-slate-900 text-slate-100 rounded-lg border border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setIsAssistantModalOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleSaveAssistant}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {editingAssistant ? text.btnUpdate : text.btnCreate}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRM DELETE ASSISTANT (UC 1.4) */}
      {deleteAssistantConfirmId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-slate-900 text-lg">{text.confirmDeleteAssistantTitle}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-5">
                {text.confirmDeleteAssistantMsg}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteAssistantConfirmId(null)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={confirmDeleteAssistant}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {text.btnDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: UPLOAD FILE (UC 2.1) */}
      {isUploadFileModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">{text.uploadFileModalTitle}</h3>
              <button
                disabled={isUploadingFiles}
                onClick={closeFileUpload}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Drag and drop box */}
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingUpload(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingUpload(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingUpload(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingUpload(false);
                  if (!isUploadingFiles && e.dataTransfer.files.length > 0) {
                    setSelectedUploadFiles(Array.from(e.dataTransfer.files));
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  isDraggingUpload
                    ? "border-blue-500 bg-blue-50/70"
                    : "border-slate-200 hover:border-blue-400 bg-slate-50/50"
                }`}
              >
                <Upload className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <input
                  ref={uploadFileInputRef}
                  type="file"
                  multiple
                  disabled={isUploadingFiles}
                  accept=".pdf,.docx,.xlsx,.html,.htm,.txt,.md,.csv,image/*"
                  onChange={(event) => {
                    const input = event.currentTarget;
                    const picked = Array.from(input.files ?? []);
                    input.value = "";
                    if (picked.length) setSelectedUploadFiles(picked);
                  }}
                  hidden
                />
                <button
                  type="button"
                  disabled={isUploadingFiles}
                  onClick={() => uploadFileInputRef.current?.click()}
                  className="mb-1 inline-flex rounded px-2 py-1 text-xs font-bold text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 enabled:cursor-pointer disabled:opacity-50"
                >
                  {text.chooseFiles}
                </button>
                <p className="text-[11px] text-slate-400">{text.dragDropHint}</p>
                {selectedUploadFiles.length > 0 && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg text-left text-[11px] text-blue-700 font-medium">
                    {text.selectedFilesLabel} ({selectedUploadFiles.length}): {selectedUploadFiles.map((f) => f.name).join(", ")}
                  </div>
                )}
              </div>

              {/* Target Folder */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.targetFolder}
                </label>
                <select
                  value={uploadTargetFolder}
                  onChange={(e) => setUploadTargetFolder(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 mb-2 cursor-pointer"
                >
                  <option value="root">{text.rootFolder}</option>
                  <option value="policy">policy/</option>
                  <option value="finance">finance/</option>
                  <option value="technical">technical/</option>
                </select>
                <input
                  type="text"
                  placeholder={text.customFolderPlaceholder}
                  value={customUploadFolder}
                  onChange={(e) => setCustomUploadFolder(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                disabled={isUploadingFiles}
                onClick={closeFileUpload}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                disabled={isUploadingFiles}
                onClick={() => void handleUploadFileSubmit()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isUploadingFiles ? text.uploadingFile : text.btnUpload}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: UPLOAD FROM URL (UC 2.2) */}
      {isUploadUrlModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">{text.uploadUrlModalTitle}</h3>
              <button
                onClick={() => setIsUploadUrlModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.sourceUrl} *
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/handbook-policy"
                  value={urlSourceInput}
                  onChange={(e) => setUrlSourceInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.saveAsFilename}
                </label>
                <input
                  type="text"
                  placeholder={text.phFilename}
                  value={urlCustomFilename}
                  onChange={(e) => setUrlCustomFilename(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.targetFolder}
                </label>
                <select
                  value={urlTargetFolder}
                  onChange={(e) => setUrlTargetFolder(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 mb-2 cursor-pointer"
                >
                  <option value="root">{text.rootFolder}</option>
                  <option value="web-docs">web-docs/</option>
                  <option value="faq">faq/</option>
                </select>
                <input
                  type="text"
                  placeholder={text.customFolderPlaceholder}
                  value={urlCustomFolder}
                  onChange={(e) => setUrlCustomFolder(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setIsUploadUrlModalOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleUploadUrlSubmit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {text.btnFetchUpload}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: PREVIEW FILE (UC 2.4) */}
      {previewFileItem && (
        <KbFilePreview
          key={previewFileItem.id}
          file={previewFileItem}
          labels={text}
          onClose={() => setPreviewFileItem(null)}
        />
      )}

      {/* MODAL 6: CONFIRM DELETE FILE (UC 2.7) */}
      {deleteFileConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-slate-900 text-lg">{text.confirmDeleteFileTitle}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-5 [overflow-wrap:anywhere]">
                {deleteFileConfirmItem.folder}/{deleteFileConfirmItem.filename}
              </p>
              <p className="text-sm text-rose-600 font-semibold leading-5">
                {text.confirmDeleteFileMsg}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteFileConfirmItem(null)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleDeleteFileConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {text.btnDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: CREATE / EDIT STANCE */}
      {isStanceModalOpen && (
        <div
          role="dialog"
          aria-labelledby="stance-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 backdrop-blur-xs sm:p-4"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveStance();
            }}
            className="flex max-h-[calc(100dvh_-_1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-scaleIn sm:max-h-[calc(100dvh_-_2rem)]"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 sm:px-6 sm:py-3.5 [@media(max-height:520px)]:py-2">
              <h3 id="stance-modal-title" className="text-base font-bold text-slate-900 sm:text-lg">
                {editingStance
                  ? lang === "vi"
                    ? "Chi tiết phong cách giao tiếp"
                    : lang === "ja"
                    ? "スタンス詳細"
                    : lang === "zh"
                    ? "风格详情"
                    : "Stance Details"
                  : text.createStanceTitle}
              </h3>
              <button
                type="button"
                aria-label={text.btnCancel}
                onClick={() => setIsStanceModalOpen(false)}
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid min-h-0 auto-rows-max grid-cols-2 gap-x-3 gap-y-2.5 overflow-y-auto overscroll-contain px-4 py-3 sm:grid-cols-6 sm:gap-x-4 sm:gap-y-3.5 sm:px-6 sm:py-5 [@media(max-height:520px)]:gap-y-2 [@media(max-height:520px)]:py-2.5">
              <label className={`${stanceFieldClassName} col-span-2 sm:col-span-3`}>
                <span>{text.lblAssistant} *</span>
                <span className="relative block">
                  <select
                    aria-required="true"
                    value={stanceForm.assistantId}
                    onChange={(e) => setStanceForm({ ...stanceForm, assistantId: Number(e.target.value) })}
                    className={stanceSelectClassName}
                  >
                    {assistantsList.map((ast) => (
                      <option key={ast.id} value={ast.id}>
                        [{ast.id}] {ast.name[lang] || Object.values(ast.name)[0]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                </span>
              </label>

              <label className={`${stanceFieldClassName} sm:col-span-2`}>
                <span>{text.lblStanceName} *</span>
                <input
                  type="text"
                  aria-required="true"
                  value={stanceForm.name}
                  onChange={(e) => setStanceForm({ ...stanceForm, name: e.target.value })}
                  placeholder={text.phStanceName}
                  className={stanceControlClassName}
                />
              </label>

              <label className={stanceFieldClassName}>
                <span>{text.lblVersion} *</span>
                <input
                  type="text"
                  aria-required="true"
                  value={stanceForm.version}
                  onChange={(e) => setStanceForm({ ...stanceForm, version: e.target.value })}
                  className={stanceControlClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} sm:col-span-3`}>
                <span>{text.lblTone}</span>
                <textarea
                  rows={2}
                  value={stanceForm.tone}
                  onChange={(e) => setStanceForm({ ...stanceForm, tone: e.target.value })}
                  placeholder={text.phTone}
                  className={stanceTextareaClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} sm:col-span-3`}>
                <span>{text.lblAttitude}</span>
                <textarea
                  rows={2}
                  value={stanceForm.attitude}
                  onChange={(e) => setStanceForm({ ...stanceForm, attitude: e.target.value })}
                  placeholder={text.phAttitude}
                  className={stanceTextareaClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} sm:col-span-3`}>
                <span>{text.lblLexicon}</span>
                <textarea
                  rows={2}
                  value={stanceForm.lexicon}
                  onChange={(e) => setStanceForm({ ...stanceForm, lexicon: e.target.value })}
                  placeholder={text.phLexicon}
                  className={stanceTextareaClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} sm:col-span-3`}>
                <span>{text.lblPrecision}</span>
                <textarea
                  rows={2}
                  value={stanceForm.precision}
                  onChange={(e) => setStanceForm({ ...stanceForm, precision: e.target.value })}
                  placeholder={text.phPrecision}
                  className={stanceTextareaClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} col-span-full`}>
                <span>{text.lblBoundaries}</span>
                <textarea
                  rows={4}
                  value={stanceForm.boundaries}
                  onChange={(e) => setStanceForm({ ...stanceForm, boundaries: e.target.value })}
                  placeholder={text.phBoundaries}
                  className={stanceTextareaClassName}
                />
              </label>

              <label className={`${stanceFieldClassName} col-start-2 sm:col-span-2 sm:col-start-5`}>
                <span>{text.thState}</span>
                <span className="relative block">
                  <select
                    value={stanceForm.state}
                    onChange={(e) => setStanceForm({ ...stanceForm, state: Number(e.target.value) })}
                    className={stanceSelectClassName}
                  >
                    <option value={1}>{text.badgeActive}</option>
                    <option value={0}>{text.badgeInactive}</option>
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                </span>
              </label>
            </div>

            <div className="flex shrink-0 justify-end gap-2.5 border-t border-slate-100 bg-slate-50 px-4 py-2.5 sm:px-6 sm:py-3.5 [@media(max-height:520px)]:py-2">
              <button
                type="button"
                onClick={() => setIsStanceModalOpen(false)}
                className="min-h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {text.btnCancel}
              </button>
              <button
                type="submit"
                className="min-h-9 cursor-pointer rounded-lg bg-[#0B132B] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                {editingStance ? text.btnSave : text.btnCreate}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 8: CREATE / EDIT LEXEME (UC 3.1 & 3.3) */}
      {isLexemeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">
                {editingLexeme ? text.editLexemeTitle : text.createLexemeTitle}
              </h3>
              <button
                onClick={() => setIsLexemeModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.lblGrapheme} *
                </label>
                <input
                  type="text"
                  value={lexemeForm.grapheme}
                  onChange={(e) => setLexemeForm({ ...lexemeForm, grapheme: e.target.value })}
                  placeholder={text.phGrapheme}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.lblType}
                </label>
                <select
                  value={lexemeForm.type}
                  onChange={(e) => setLexemeForm({ ...lexemeForm, type: e.target.value as "Phoneme" | "Alias" })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="Phoneme">{text.optPhoneme}</option>
                  <option value="Alias">{text.optAlias}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {text.lblReading} *
                </label>
                <input
                  type="text"
                  value={lexemeForm.phoneme}
                  onChange={(e) => setLexemeForm({ ...lexemeForm, phoneme: e.target.value })}
                  placeholder={text.phReading}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setIsLexemeModalOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleSaveLexeme}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {editingLexeme ? text.btnUpdate : text.btnCreate}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 9: CONFIRM DELETE LEXEME (UC 3.5) */}
      {deleteLexemeConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-slate-900 text-lg">{text.confirmDeleteLexemeTitle}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-5 [overflow-wrap:anywhere]">
                {text.confirmDeleteLexemeMsg.replace("{0}", deleteLexemeConfirmItem.grapheme)}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteLexemeConfirmItem(null)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleDeleteLexemeConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {text.btnDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 10: VIEW CHAT DETAIL (UC 6.1) */}
      {viewChatDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  {text.chatDetailTitle}
                </h3>
              </div>
              <button
                onClick={() => setViewChatDetail(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono">
                <div>{text.chatId}: <strong>#{viewChatDetail.id}</strong></div>
                <div>{text.thSource}: <strong className="uppercase text-blue-600">{viewChatDetail.source}</strong></div>
                <div className="col-span-2">{text.sessionId}: <strong>{viewChatDetail.sessionId}</strong></div>
                <div>{text.lblQuestionAt}: <span className="text-slate-700">{viewChatDetail.questionAt}</span></div>
                <div>{text.lblAnswerAt}: <span className="text-slate-700">{viewChatDetail.answerAt}</span></div>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 block mb-1">{text.lblQuestion}:</span>
                <p className="text-xs font-medium text-slate-900 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                  {viewChatDetail.question}
                </p>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 block mb-1">{text.lblAnswer}:</span>
                <p className="text-xs text-slate-700 p-3.5 bg-slate-50 rounded-lg border border-slate-100 leading-relaxed whitespace-pre-wrap">
                  {viewChatDetail.answer}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setViewChatDetail(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
              >
                {text.btnCancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 11: CONFIRM DELETE CHAT RECORD (UC 6.2) */}
      {deleteChatConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-[31rem] overflow-hidden animate-scaleIn">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-slate-900 text-lg">{text.confirmDeleteChatTitle}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-5">
                {text.confirmDeleteChatMsg}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteChatConfirmItem(null)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg cursor-pointer"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={handleDeleteChatConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                {text.btnDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 13: CONFIRM DELETE BACKGROUND (UC 8.2) */}
      {deleteBgConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-slate-900 text-lg">{text.confirmDeleteBgTitle}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-5">
                {text.confirmDeleteBgMsg}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteBgConfirmItem(null)}
                disabled={backgroundAction === "delete"}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                {text.btnCancel}
              </button>
              <button
                onClick={() => void updateBackground(deleteBgConfirmItem.id, "delete")}
                disabled={backgroundAction !== null}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                {text.btnDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
