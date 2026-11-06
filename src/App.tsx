import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  reload,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  increment,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import {
  FileText,
  UploadCloud,
  Search,
  Eye,
  Download,
  Trash2,
  LogOut,
  User,
  LogIn,
  PlusCircle,
  X,
  Calendar,
  HardDrive,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Lock,
  Mail,
  Key,
  Share2,
  ExternalLink,
  Info,
  RefreshCw,
} from 'lucide-react';

/* ====================================================================
   Konfigurasi & konstanta
   ==================================================================== */

// Variabel global ini disuntikkan oleh lingkungan Canvas (jika ada).
declare const __firebase_config: string | undefined;
declare const __app_id: string | undefined;
declare const __initial_auth_token: string | undefined;

const PLACEHOLDER_API_KEY = 'ISI_API_KEY_ANDA';

// Isi dengan config proyek Firebase Anda sendiri (Project settings > Your apps).
const FALLBACK_FIREBASE_CONFIG: Record<string, string> = {
  apiKey: "AIzaSyDIFO_02Su-kQ1T-8pZkDV4V86WuOlGCNc",
  authDomain: "pdf-vault-agus.firebaseapp.com",
  projectId: "pdf-vault-agus",
  storageBucket: "pdf-vault-agus.firebasestorage.app",
  messagingSenderId: "64041272057",
  appId: "1:64041272057:web:087dd7b6bc6304ca0ed828"
};

function loadFirebaseConfig(): Record<string, string> {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
      return JSON.parse(__firebase_config);
    } catch (e) {
      console.error('__firebase_config bukan JSON yang valid:', e);
    }
  }
  return FALLBACK_FIREBASE_CONFIG;
}

const firebaseConfig = loadFirebaseConfig();
// Tidak ada lagi "mode demo" diam-diam: jika belum dikonfigurasi, UI menampilkan peringatan.
const isConfigured = Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== PLACEHOLDER_API_KEY;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' && __app_id ? __app_id : 'pdf-vault-app';

const CATEGORIES = ['Dokumen', 'Buku/Ebook', 'Pendidikan', 'Teknologi', 'Lainnya'] as const;
const FILTER_CATEGORIES = ['Semua', ...CATEGORIES];

// Batas dokumen Firestore 1 MiB. 600 KB -> ~800 KB base64, masih aman.
const MAX_FILE_SIZE_BYTES = 600 * 1024;
const PAGE_SIZE = 24;
const LIMITS = { title: 120, description: 500, tags: 8, tagLength: 24 };

// Metadata (kecil) dan isi file (besar) dipisah supaya daftar tidak mengunduh semua PDF.
const pdfCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'pdfs');
const pdfDocRef = (id: string) => doc(db, 'artifacts', appId, 'public', 'data', 'pdfs', id);
const fileDocRef = (id: string) => doc(db, 'artifacts', appId, 'public', 'data', 'pdfFiles', id);

/* ====================================================================
   Tipe
   ==================================================================== */

interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

interface PdfMeta {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  size: string;
  views: number;
  uploaderId: string;
  uploaderName: string;
  createdAt: number | null;
}

type SortBy = 'newest' | 'oldest' | 'title';
type ToastType = 'success' | 'error';
interface ToastState {
  message: string;
  type: ToastType;
}
type ShowToast = (message: string, type?: ToastType) => void;

/* ====================================================================
   Helper
   ==================================================================== */

function toAppUser(u: FirebaseUser | null): AppUser | null {
  if (!u) return null;
  return { uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: u.emailVerified };
}

function toPdfMeta(id: string, d: DocumentData): PdfMeta {
  const ts = d.createdAt;
  return {
    id,
    title: String(d.title ?? ''),
    description: String(d.description ?? ''),
    category: String(d.category ?? 'Dokumen'),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    size: String(d.size ?? 'PDF'),
    views: Number(d.views) || 0,
    uploaderId: String(d.uploaderId ?? ''),
    uploaderName: String(d.uploaderName ?? 'Anggota Vault'),
    createdAt:
      ts && typeof ts.toMillis === 'function' ? ts.toMillis() : typeof ts === 'number' ? ts : null,
  };
}

function errCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  return '';
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : '');

function authErrorMessage(err: unknown): string {
  switch (errCode(err)) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email atau kata sandi tidak cocok';
    case 'auth/invalid-email':
      return 'Format email tidak valid';
    case 'auth/email-already-in-use':
      return 'Email sudah terdaftar. Silakan masuk';
    case 'auth/weak-password':
      return 'Kata sandi minimal 6 karakter';
    case 'auth/too-many-requests':
      return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi';
    case 'auth/network-request-failed':
      return 'Tidak ada koneksi internet. Periksa jaringan Anda';
    case 'auth/operation-not-allowed':
      return 'Login email/kata sandi belum diaktifkan di Firebase Console (Authentication > Sign-in method)';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return 'API key Firebase tidak valid. Periksa konfigurasi aplikasi';
    default:
      return 'Terjadi kesalahan. Silakan coba lagi';
  }
}

function fileErrorMessage(err: unknown): string {
  if (errMessage(err) === 'FILE_NOT_FOUND') return 'Berkas tidak ditemukan. Mungkin sudah dihapus';
  if (errMessage(err) === 'FILE_INVALID') return 'Isi berkas rusak atau bukan PDF yang valid';
  if (errCode(err) === 'permission-denied') return 'Tidak ada izin untuk membaca berkas ini';
  if (errCode(err) === 'unavailable') return 'Tidak ada koneksi. Coba lagi setelah online';
  return 'Gagal memuat berkas PDF';
}

function uploadErrorMessage(err: unknown): string {
  if (errMessage(err) === 'TIMEOUT')
    return 'Koneksi lambat. Unggahan mungkin tetap terkirim, periksa daftar sebelum mengulang';
  const code = errCode(err);
  if (code === 'permission-denied')
    return 'Tidak punya izin mengunggah. Pastikan email sudah terverifikasi dan aturan Firestore sudah dipasang';
  if (code === 'unavailable') return 'Tidak ada koneksi. Coba lagi setelah online';
  if (code === 'invalid-argument' || code === 'resource-exhausted')
    return 'Berkas melebihi batas penyimpanan database';
  return 'Gagal mengunggah berkas. Coba lagi';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 80);
  return `${cleaned || 'dokumen'}.pdf`;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

// Isi PDF diambil on-demand dan selalu dibangun ulang menjadi Blob dari byte yang sudah
// diperiksa (header %PDF-). URL yang dipakai iframe/link adalah blob: buatan kita sendiri,
// bukan string dari database, sehingga tidak ada celah javascript:/data:text/html.
async function fetchPdfBlob(id: string): Promise<Blob> {
  const snap = await getDoc(fileDocRef(id));
  if (!snap.exists()) throw new Error('FILE_NOT_FOUND');
  const base64 = snap.data().data;
  if (typeof base64 !== 'string') throw new Error('FILE_INVALID');
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error('FILE_INVALID');
  }
  if (!binary.startsWith('%PDF-')) throw new Error('FILE_INVALID');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* lanjut ke fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const buildShareLink = (id: string) =>
  `${window.location.origin}${window.location.pathname}${window.location.search}#pdf=${id}`;

function setPdfHash(id: string | null) {
  try {
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', id ? `${base}#pdf=${id}` : base);
  } catch {
    /* beberapa lingkungan (iframe sandbox) melarang history API */
  }
}

/* ====================================================================
   Komponen dasar: kerangka modal (Esc, role dialog, klik latar)
   ==================================================================== */

function ModalShell({
  onClose,
  labelledBy,
  overlayClassName = 'items-center justify-center p-4',
  panelClassName,
  closeOnBackdrop = true,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  overlayClassName?: string;
  panelClassName: string;
  closeOnBackdrop?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-slate-950/80 backdrop-blur-sm ${overlayClassName}`}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={panelClassName}>
        {children}
      </div>
    </div>
  );
}

/* ====================================================================
   App
   ==================================================================== */

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(isConfigured);

  const [pdfList, setPdfList] = useState<PdfMeta[]>([]);
  const [listLoading, setListLoading] = useState(isConfigured);
  const [listError, setListError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<PdfMeta | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const deepLinkDone = useRef(false);

  const showToast = useCallback<ShowToast>((message, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 6000 : 4000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  /* ---------- Auth: hanya user Firebase asli, tanpa sesi tiruan ---------- */
  useEffect(() => {
    if (!isConfigured) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(toAppUser(u));
      setAuthLoading(false);
    });
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
      signInWithCustomToken(auth, __initial_auth_token).catch((e) =>
        console.warn('Custom token gagal:', errCode(e))
      );
    }
    return unsubscribe;
  }, []);

  /* ---------- Daftar PDF: hanya metadata, terurut dan dibatasi di server ---------- */
  useEffect(() => {
    if (!isConfigured || authLoading) return;
    setListError(null);
    const field = sortBy === 'title' ? 'titleLower' : 'createdAt';
    const direction = sortBy === 'newest' ? 'desc' : 'asc';
    const q = query(pdfCollection(), orderBy(field, direction), limit(visibleLimit));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPdfList(snapshot.docs.map((d) => toPdfMeta(d.id, d.data({ serverTimestamps: 'estimate' }))));
        setHasMore(snapshot.size >= visibleLimit);
        setListLoading(false);
      },
      (error) => {
        console.error('Gagal memuat daftar PDF:', error);
        setListError(
          errCode(error) === 'permission-denied'
            ? 'Akses ke perpustakaan ditolak. Periksa aturan Firestore.'
            : 'Gagal memuat perpustakaan. Periksa koneksi Anda.'
        );
        setListLoading(false);
      }
    );
    return unsubscribe;
  }, [authLoading, user?.uid, sortBy, visibleLimit, retryTick]);

  /* ---------- Hitung "dilihat": sekali per sesi, atomik ---------- */
  const countView = useCallback((id: string) => {
    if (viewedRef.current.has(id)) return;
    viewedRef.current.add(id);
    updateDoc(pdfDocRef(id), { views: increment(1) }).catch((e) =>
      console.warn('Hitungan dilihat tidak tersimpan:', errCode(e))
    );
  }, []);

  const openPreview = useCallback(
    (pdf: PdfMeta) => {
      setPreviewPdf(pdf);
      setPdfHash(pdf.id);
      countView(pdf.id);
    },
    [countView]
  );

  const closePreview = useCallback(() => {
    setPreviewPdf(null);
    setPdfHash(null);
  }, []);

  /* ---------- Tautan langsung: #pdf=<id> ---------- */
  useEffect(() => {
    if (!isConfigured || authLoading || deepLinkDone.current) return;
    deepLinkDone.current = true;
    const match = window.location.hash.match(/^#pdf=([A-Za-z0-9]+)$/);
    if (!match) return;
    getDoc(pdfDocRef(match[1]))
      .then((snap) => {
        if (snap.exists()) openPreview(toPdfMeta(snap.id, snap.data()));
        else showToast('Dokumen pada tautan tidak ditemukan', 'error');
      })
      .catch(() => showToast('Gagal membuka dokumen dari tautan', 'error'));
  }, [authLoading, openPreview, showToast]);

  /* ---------- Aksi ---------- */
  const requireConfig = () => {
    if (isConfigured) return true;
    showToast('Firebase belum dikonfigurasi. Isi FALLBACK_FIREBASE_CONFIG di kode.', 'error');
    return false;
  };

  const openAuth = () => {
    if (requireConfig()) setIsAuthModalOpen(true);
  };

  const openUploadFlow = () => {
    if (!requireConfig()) return;
    if (!user) return setIsAuthModalOpen(true);
    if (!user.emailVerified) {
      return showToast('Verifikasi email Anda terlebih dahulu sebelum mengunggah', 'error');
    }
    setIsUploadModalOpen(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast('Berhasil keluar dari akun');
    } catch (e) {
      console.warn('Logout gagal:', e);
      showToast('Gagal keluar dari akun. Coba lagi', 'error');
    }
  };

  const handleResendVerification = async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      await sendEmailVerification(u);
      showToast('Email verifikasi dikirim. Cek kotak masuk atau folder spam');
    } catch (e) {
      showToast(authErrorMessage(e), 'error');
    }
  };

  const handleCheckVerification = async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      await reload(u);
      await u.getIdToken(true); // segarkan token agar aturan Firestore melihat email_verified terbaru
      setUser(toAppUser(u));
      if (u.emailVerified) showToast('Email berhasil diverifikasi');
      else showToast('Email belum terverifikasi. Klik tautan di email Anda dulu', 'error');
    } catch (e) {
      showToast(authErrorMessage(e), 'error');
    }
  };

  const handleShare = async (pdf: PdfMeta) => {
    const link = buildShareLink(pdf.id);
    const ok = await copyText(link);
    if (ok) showToast('Tautan dokumen disalin');
    else showToast(`Gagal menyalin otomatis. Salin manual: ${link}`, 'error');
  };

  const handleDownload = async (pdf: PdfMeta) => {
    if (downloadingId) return;
    setDownloadingId(pdf.id);
    try {
      const blob = await fetchPdfBlob(pdf.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFileName(pdf.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      showToast(fileErrorMessage(e), 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const confirmDeletePdf = async () => {
    const target = pdfList.find((p) => p.id === deleteTargetId);
    if (!target || !user || target.uploaderId !== user.uid) {
      setDeleteTargetId(null);
      return;
    }
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      batch.delete(pdfDocRef(target.id));
      batch.delete(fileDocRef(target.id));
      await withTimeout(batch.commit(), 20000);
      showToast('Dokumen PDF berhasil dihapus');
    } catch (e) {
      // Tidak ada penghapusan "pura-pura" di sisi lokal: jika server menolak, dokumen tetap ada.
      showToast(
        errCode(e) === 'permission-denied'
          ? 'Anda tidak berhak menghapus dokumen ini'
          : 'Gagal menghapus dokumen. Coba lagi',
        'error'
      );
    } finally {
      setIsDeleting(false);
      setDeleteTargetId(null);
    }
  };

  /* ---------- Filter (urutan sudah ditangani server) ---------- */
  const searchLower = searchTerm.toLowerCase().trim();
  const filteredPdfs = pdfList.filter((pdf) => {
    const matchesSearch =
      !searchLower ||
      pdf.title.toLowerCase().includes(searchLower) ||
      pdf.description.toLowerCase().includes(searchLower) ||
      pdf.uploaderName.toLowerCase().includes(searchLower) ||
      pdf.tags.some((t) => t.toLowerCase().includes(searchLower));
    const matchesCategory = selectedCategory === 'Semua' || pdf.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });
  const hasActiveFilter = Boolean(searchLower) || selectedCategory !== 'Semua';
  const deleteTarget = pdfList.find((p) => p.id === deleteTargetId);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 left-5 sm:left-auto z-[60] flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md border border-slate-700 bg-slate-800/90 text-white"
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm font-medium break-words min-w-0">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-lg border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-tr from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
                <FileText className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-extrabold text-lg text-white tracking-tight">Public PDF Vault</h1>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Perpustakaan & Berbagi Berkas Digital Publik
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {user ? (
                <>
                  {user.emailVerified && (
                    <button
                      onClick={openUploadFlow}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all"
                    >
                      <PlusCircle className="w-4 h-4" aria-hidden="true" />
                      <span>Unggah PDF</span>
                    </button>
                  )}
                  <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
                    <div className="hidden md:flex flex-col text-right">
                      <span className="text-sm font-semibold text-slate-200">
                        {user.displayName || 'Anggota Vault'}
                      </span>
                      <span
                        className={`text-xs flex items-center justify-end gap-1 ${
                          user.emailVerified ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
                        {user.emailVerified ? 'Email terverifikasi' : 'Email belum diverifikasi'}
                      </span>
                    </div>
                    <div
                      className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400 font-bold shadow-inner"
                      aria-hidden="true"
                    >
                      {user.displayName || user.email ? (
                        (user.displayName || user.email || '?').charAt(0).toUpperCase()
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </div>
                    <button
                      onClick={handleLogout}
                      title="Keluar akun"
                      aria-label="Keluar akun"
                      className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={openAuth}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-indigo-600/20"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  <span>Masuk / Daftar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Banner: belum dikonfigurasi */}
      {!isConfigured && (
        <div className="bg-rose-500/10 border-b border-rose-500/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              Firebase belum dikonfigurasi, jadi login, daftar, dan unggah dinonaktifkan. Isi{' '}
              <code className="font-mono">FALLBACK_FIREBASE_CONFIG</code> dengan config proyek Anda.
            </p>
          </div>
        </div>
      )}

      {/* Banner: email belum terverifikasi */}
      {user && !user.emailVerified && (
        <div className="bg-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-amber-200 flex items-start gap-2">
              <Mail className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              Verifikasi email Anda untuk mengunggah PDF. Kami sudah mengirim tautan ke {user.email}.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleResendVerification}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                Kirim ulang email
              </button>
              <button
                onClick={handleCheckVerification}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900"
              >
                Saya sudah verifikasi
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-800/80 via-slate-800/50 to-indigo-950/40 border border-slate-800 p-6 md:p-8">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-4">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Dibaca oleh siapa saja, diunggah oleh anggota
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Temukan & Bagikan Dokumen PDF dengan Mudah
            </h2>
            <p className="mt-2 text-slate-400 text-sm md:text-base leading-relaxed">
              Jelajahi koleksi PDF publik dari berbagai kategori dan baca langsung tanpa unduh. Masuk dan
              verifikasi email untuk membagikan berkas PDF Anda sendiri.
            </p>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 bg-gradient-to-l from-indigo-500 to-transparent pointer-events-none" />
        </section>

        {/* Filter */}
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="Cari PDF"
                placeholder="Cari judul, deskripsi, atau kata kunci..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-10 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="sort-by" className="text-xs text-slate-400 font-medium shrink-0">
                Urutkan:
              </label>
              <select
                id="sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
              >
                <option value="newest">Terbaru</option>
                <option value="oldest">Terlama</option>
                <option value="title">Judul (A-Z)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                aria-pressed={selectedCategory === cat}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700/50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* Error daftar */}
        {listError && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
            <span className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" /> {listError}
            </span>
            <button
              onClick={() => {
                setListLoading(true);
                setRetryTick((n) => n + 1);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Coba lagi
            </button>
          </div>
        )}

        {/* Galeri */}
        {authLoading || (listLoading && pdfList.length === 0) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-slate-800/50 animate-pulse border border-slate-800" />
            ))}
          </div>
        ) : filteredPdfs.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPdfs.map((pdf) => (
                <PdfCard
                  key={pdf.id}
                  pdf={pdf}
                  isOwner={Boolean(user && user.uid === pdf.uploaderId)}
                  downloading={downloadingId === pdf.id}
                  onPreview={() => openPreview(pdf)}
                  onDelete={() => setDeleteTargetId(pdf.id)}
                  onShare={() => handleShare(pdf)}
                  onDownload={() => handleDownload(pdf)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex flex-col items-center gap-1 pt-2">
                <button
                  onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-xl border border-slate-700 transition-colors"
                >
                  Muat lebih banyak
                </button>
                {hasActiveFilter && (
                  <p className="text-xs text-slate-500">Pencarian dan kategori hanya mencakup berkas yang sudah dimuat.</p>
                )}
              </div>
            )}
          </>
        ) : !listError ? (
          <EmptyState
            hasActiveFilter={hasActiveFilter}
            hasMore={hasMore}
            onClearFilters={() => {
              setSearchTerm('');
              setSelectedCategory('Semua');
            }}
            onLoadMore={() => setVisibleLimit((n) => n + PAGE_SIZE)}
            onOpenUpload={openUploadFlow}
          />
        ) : null}
      </main>

      {isUploadModalOpen && user && (
        <UploadModal user={user} onClose={() => setIsUploadModalOpen(false)} showToast={showToast} />
      )}

      {isAuthModalOpen && (
        <AuthModal
          onClose={() => setIsAuthModalOpen(false)}
          onSuccess={() => setUser(toAppUser(auth.currentUser))}
          showToast={showToast}
        />
      )}

      {previewPdf && (
        <PdfViewerModal pdf={previewPdf} onClose={closePreview} onShare={() => handleShare(previewPdf)} />
      )}

      {deleteTargetId && (
        <ModalShell
          onClose={() => !isDeleting && setDeleteTargetId(null)}
          labelledBy="delete-title"
          panelClassName="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-center"
        >
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h3 id="delete-title" className="font-bold text-slate-100 text-lg">
              Hapus PDF ini?
            </h3>
            <p className="text-xs text-slate-400 mt-1 break-words">
              {deleteTarget ? `"${deleteTarget.title}" ` : ''}akan dihapus permanen dari perpustakaan publik.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              autoFocus
              disabled={isDeleting}
              onClick={() => setDeleteTargetId(null)}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              disabled={isDeleting}
              onClick={confirmDeletePdf}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all disabled:opacity-60"
            >
              {isDeleting ? 'Menghapus...' : 'Hapus'}
            </button>
          </div>
        </ModalShell>
      )}

      <footer className="mt-auto border-t border-slate-800 bg-slate-900/60 py-6 text-center text-xs text-slate-500">
        <p>© {new Date().getFullYear()} Public PDF Vault. Dibuat untuk berbagi pengetahuan secara luas.</p>
      </footer>
    </div>
  );
}

/* ====================================================================
   Empty state
   ==================================================================== */
function EmptyState({
  hasActiveFilter,
  hasMore,
  onClearFilters,
  onLoadMore,
  onOpenUpload,
}: {
  hasActiveFilter: boolean;
  hasMore: boolean;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onOpenUpload: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-slate-800/30 border border-slate-800 rounded-2xl space-y-4">
      <div className="p-4 bg-slate-800 rounded-full text-slate-400 border border-slate-700">
        <FileText className="w-10 h-10" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1">
        <h3 className="text-lg font-bold text-slate-200">
          {hasActiveFilter ? 'Tidak ada hasil ditemukan' : 'Belum ada berkas PDF publik'}
        </h3>
        <p className="text-xs text-slate-400">
          {hasActiveFilter
            ? 'Tidak ada dokumen yang cocok dengan pencarian atau kategori ini.'
            : 'Belum ada yang membagikan berkas PDF. Jadilah yang pertama mengunggah.'}
        </p>
      </div>
      {hasActiveFilter ? (
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
          >
            Hapus pencarian dan filter
          </button>
          {hasMore && (
            <button
              onClick={onLoadMore}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              Muat lebih banyak berkas
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={onOpenUpload}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Unggah dokumen pertama</span>
        </button>
      )}
    </div>
  );
}

/* ====================================================================
   Kartu PDF
   ==================================================================== */
function PdfCard({
  pdf,
  isOwner,
  downloading,
  onPreview,
  onDelete,
  onShare,
  onDownload,
}: {
  pdf: PdfMeta;
  isOwner: boolean;
  downloading: boolean;
  onPreview: () => void;
  onDelete: () => void;
  onShare: () => void;
  onDownload: () => void;
}) {
  const formattedDate = pdf.createdAt
    ? new Date(pdf.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Baru saja';

  return (
    <div className="group relative flex flex-col bg-slate-800/60 border border-slate-700/70 hover:border-slate-600 rounded-2xl p-5 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all shrink-0">
            <FileText className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-md bg-slate-700/60 text-indigo-300 border border-slate-600/50">
              {pdf.category}
            </span>
            <span className="mt-1 text-xs text-slate-400 flex items-center gap-2">
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" aria-hidden="true" /> {pdf.size}
              </span>
              <span aria-hidden="true">•</span>
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" aria-hidden="true" /> {pdf.views}x
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onShare}
            title="Bagikan tautan"
            aria-label={`Bagikan tautan ${pdf.title}`}
            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          {isOwner && (
            <button
              onClick={onDelete}
              title="Hapus PDF saya"
              aria-label={`Hapus ${pdf.title}`}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 mb-4">
        <h3 className="font-bold text-base text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-2">
          {pdf.title}
        </h3>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
          {pdf.description || 'Tidak ada deskripsi singkat untuk dokumen ini.'}
        </p>
        {pdf.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {pdf.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-md bg-slate-700/40 text-slate-300 border border-slate-700"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-slate-700/50 space-y-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1 min-w-0">
            <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[120px]">{pdf.uploaderName}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
            {formattedDate}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onPreview}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-700/80 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Baca / Lihat</span>
          </button>
          <button
            onClick={onDownload}
            disabled={downloading}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-700/40 hover:bg-slate-700 disabled:opacity-60 text-slate-200 border border-slate-600/50 rounded-xl text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{downloading ? 'Menyiapkan...' : 'Unduh'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
   Modal unggah
   ==================================================================== */
function UploadModal({
  user,
  onClose,
  showToast,
}: {
  user: AppUser;
  onClose: () => void;
  showToast: ShowToast;
}) {
  const uid = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('Dokumen');
  const [tags, setTags] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleClose = useCallback(() => {
    if (!isUploading) onClose();
  }, [isUploading, onClose]);

  const validateAndSetFile = async (selected?: File | null) => {
    if (!selected) return;
    const looksLikePdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) return showToast('Format berkas harus .pdf', 'error');
    if (selected.size === 0) return showToast('Berkas kosong', 'error');
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      return showToast(`Ukuran berkas maksimal ${MAX_FILE_SIZE_BYTES / 1024} KB`, 'error');
    }
    // Periksa isi, bukan hanya ekstensi/MIME yang mudah dipalsukan.
    const head = new TextDecoder().decode(await selected.slice(0, 5).arrayBuffer());
    if (head !== '%PDF-') return showToast('Isi berkas bukan PDF yang valid', 'error');
    setFile(selected);
    setTitle((prev) => prev || selected.name.replace(/\.[^/.]+$/, '').slice(0, LIMITS.title));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void validateAndSetFile(e.target.files?.[0]);
    e.target.value = ''; // izinkan memilih berkas yang sama lagi
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void validateAndSetFile(e.dataTransfer.files?.[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;
    if (!file) return showToast('Pilih berkas PDF terlebih dahulu', 'error');
    const cleanTitle = title.trim();
    if (!cleanTitle) return showToast('Judul dokumen wajib diisi', 'error');
    if (!navigator.onLine) return showToast('Anda sedang offline. Sambungkan internet lalu coba lagi', 'error');

    setIsUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const tagArray = Array.from(
        new Set(
          tags
            .split(',')
            .map((t) => t.trim().replace(/^#+/, '').toLowerCase().slice(0, LIMITS.tagLength))
            .filter(Boolean)
        )
      ).slice(0, LIMITS.tags);

      const id = doc(pdfCollection()).id;
      const batch = writeBatch(db);
      batch.set(pdfDocRef(id), {
        title: cleanTitle,
        titleLower: cleanTitle.toLowerCase(),
        description: description.trim(),
        category,
        tags: tagArray,
        size: formatFileSize(file.size),
        views: 0,
        uploaderId: user.uid,
        uploaderName: user.displayName || 'Anggota Vault', // email tidak pernah dipublikasikan
        createdAt: serverTimestamp(),
      });
      batch.set(fileDocRef(id), { data: base64, uploaderId: user.uid });
      await withTimeout(batch.commit(), 30000);

      showToast('Berhasil mengunggah dokumen PDF');
      onClose();
    } catch (error) {
      console.error('Upload error:', error);
      showToast(uploadErrorMessage(error), 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

  return (
    <ModalShell
      onClose={handleClose}
      labelledBy={`${uid}-title`}
      closeOnBackdrop={false}
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/40">
        <h3 id={`${uid}-title`} className="font-bold text-slate-100 flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-indigo-400" aria-hidden="true" /> Unggah PDF publik
        </h3>
        <button
          onClick={handleClose}
          aria-label="Tutup"
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-start gap-2.5 text-xs text-indigo-300">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Ukuran maksimum <strong>{MAX_FILE_SIZE_BYTES / 1024} KB</strong> per berkas. Berkas langsung
            terlihat oleh publik, jadi jangan unggah dokumen pribadi atau berhak cipta pihak lain.
          </p>
        </div>

        {file ? (
          <div className="flex items-center gap-3 text-left w-full border-2 border-dashed border-emerald-500/50 bg-emerald-500/5 rounded-xl p-4">
            <FileText className="w-10 h-10 text-emerald-400 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-200 truncate">{file.name}</p>
              <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Hapus berkas terpilih"
              className="p-1 text-slate-400 hover:text-rose-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              dragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/40'
            }`}
          >
            <input
              type="file"
              accept=".pdf,application/pdf"
              aria-label="Pilih berkas PDF"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <UploadCloud className="w-10 h-10 text-slate-400 mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-200">
              Tarik & lepas PDF di sini, atau <span className="text-indigo-400">cari berkas</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Hanya format .pdf (maks. {MAX_FILE_SIZE_BYTES / 1024} KB)
            </p>
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-doc-title`} className="block text-xs font-semibold text-slate-300 mb-1">
            Judul dokumen *
          </label>
          <input
            id={`${uid}-doc-title`}
            type="text"
            required
            maxLength={LIMITS.title}
            placeholder="Contoh: Panduan Pemrograman React 2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-cat`} className="block text-xs font-semibold text-slate-300 mb-1">
              Kategori
            </label>
            <select
              id={`${uid}-cat`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-tags`} className="block text-xs font-semibold text-slate-300 mb-1">
              Tag (pisahkan koma)
            </label>
            <input
              id={`${uid}-tags`}
              type="text"
              placeholder="react, tutorial, pdf"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-desc`} className="block text-xs font-semibold text-slate-300 mb-1">
            Deskripsi singkat
          </label>
          <textarea
            id={`${uid}-desc`}
            rows={3}
            maxLength={LIMITS.description}
            placeholder="Berikan ringkasan atau keterangan berkas..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div className="pt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="px-4 py-2.5 text-slate-400 hover:text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isUploading}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all"
          >
            {isUploading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Mengunggah...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" aria-hidden="true" />
                <span>Publikasikan PDF</span>
              </>
            )}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ====================================================================
   Modal login / daftar (tanpa login tiruan)
   ==================================================================== */
function AuthModal({
  onClose,
  onSuccess,
  showToast,
}: {
  onClose: () => void;
  onSuccess: () => void;
  showToast: ShowToast;
}) {
  const uid = useId();
  const [isRegister, setIsRegister] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) return showToast('Email dan kata sandi wajib diisi', 'error');
    if (isRegister && !displayName.trim()) return showToast('Nama tampilan wajib diisi', 'error');

    setLoading(true);
    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        try {
          await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 40) });
          await sendEmailVerification(cred.user);
        } catch (e2) {
          console.warn('Profil/verifikasi email gagal:', errCode(e2));
        }
        showToast('Akun dibuat. Cek email Anda untuk verifikasi sebelum mengunggah');
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
        showToast('Berhasil masuk');
      }
      onSuccess();
      onClose();
    } catch (err) {
      console.warn('Auth error:', errCode(err) || errMessage(err));
      showToast(authErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full pl-10 pr-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

  return (
    <ModalShell
      onClose={onClose}
      labelledBy={`${uid}-title`}
      panelClassName="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6"
    >
      <button
        onClick={onClose}
        aria-label="Tutup"
        className="absolute top-4 right-4 text-slate-400 hover:text-white"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="text-center space-y-2">
        <div className="inline-flex p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 mb-1">
          <Lock className="w-6 h-6" aria-hidden="true" />
        </div>
        <h3 id={`${uid}-title`} className="text-xl font-bold text-white">
          {isRegister ? 'Buat akun baru' : 'Masuk ke Vault PDF'}
        </h3>
        <p className="text-xs text-slate-400">
          {isRegister
            ? 'Daftar untuk mengunggah dan mengelola berkas PDF'
            : 'Masuk ke akun Anda untuk berkontribusi'}
        </p>
      </div>

      <form onSubmit={handleAuthSubmit} className="space-y-4">
        {isRegister && (
          <div>
            <label htmlFor={`${uid}-name`} className="block text-xs font-semibold text-slate-300 mb-1">
              Nama tampilan (terlihat publik)
            </label>
            <div className="relative">
              <User
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id={`${uid}-name`}
                type="text"
                required
                maxLength={40}
                autoComplete="nickname"
                placeholder="Nama Anda"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-email`} className="block text-xs font-semibold text-slate-300 mb-1">
            Alamat email
          </label>
          <div className="relative">
            <Mail
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id={`${uid}-email`}
              type="email"
              required
              autoComplete="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-pass`} className="block text-xs font-semibold text-slate-300 mb-1">
            Kata sandi
          </label>
          <div className="relative">
            <Key
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id={`${uid}-pass`}
              type="password"
              required
              minLength={6}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              placeholder="Minimal 6 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-70 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : isRegister ? (
            'Daftar akun'
          ) : (
            'Masuk'
          )}
        </button>
      </form>

      <div className="text-center border-t border-slate-800 pt-4">
        <p className="text-xs text-slate-400">
          {isRegister ? 'Sudah punya akun?' : 'Belum punya akun?'}{' '}
          <button
            type="button"
            onClick={() => setIsRegister((v) => !v)}
            className="text-indigo-400 font-semibold hover:underline"
          >
            {isRegister ? 'Masuk sekarang' : 'Daftar sekarang'}
          </button>
        </p>
      </div>
    </ModalShell>
  );
}

/* ====================================================================
   Penampil PDF: isi diambil saat dibuka, dirender dari blob: lokal
   ==================================================================== */
function PdfViewerModal({
  pdf,
  onClose,
  onShare,
}: {
  pdf: PdfMeta;
  onClose: () => void;
  onShare: () => void;
}) {
  const uid = useId();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setStatus('loading');
    setObjectUrl(null);

    fetchPdfBlob(pdf.id)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
        setStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMsg(fileErrorMessage(e));
        setStatus('error');
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [pdf.id]);

  return (
    <ModalShell
      onClose={onClose}
      labelledBy={`${uid}-title`}
      overlayClassName="flex-col p-4 md:p-8"
      panelClassName="flex flex-col flex-1 min-h-0"
    >
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 px-4 md:px-6 py-3 rounded-t-2xl">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-5 h-5 text-indigo-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id={`${uid}-title`} className="font-bold text-slate-100 text-sm md:text-base truncate">
              {pdf.title}
            </h3>
            <p className="text-xs text-slate-400 truncate">Diunggah oleh: {pdf.uploaderName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onShare}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Bagikan</span>
          </button>
          {objectUrl && (
            <a
              href={objectUrl}
              download={safeFileName(pdf.title)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Unduh</span>
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Tutup pratinjau"
            autoFocus
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {status === 'ready' && objectUrl && (
        <div className="flex items-center justify-between gap-3 bg-slate-900 border-x border-slate-800 px-4 md:px-6 py-2 text-xs text-slate-400">
          <span>PDF tidak tampil di perangkat ini? Beberapa browser seluler tidak menampilkan PDF dalam bingkai.</span>
          <a
            href={objectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-indigo-400 font-semibold hover:underline shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Buka di tab baru
          </a>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-slate-900 border-x border-b border-slate-800 rounded-b-2xl overflow-hidden relative">
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 text-sm" aria-busy="true">
            <span className="w-6 h-6 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />
            Memuat dokumen...
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center h-full space-y-3 p-6 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400" aria-hidden="true" />
            <h4 className="font-bold text-slate-200">Dokumen tidak dapat dimuat</h4>
            <p className="text-xs text-slate-400 max-w-sm">{errorMsg}</p>
          </div>
        )}
        {status === 'ready' && objectUrl && (
          <iframe src={objectUrl} title={pdf.title} className="w-full h-full border-none bg-white" />
        )}
      </div>
    </ModalShell>
  );
}
