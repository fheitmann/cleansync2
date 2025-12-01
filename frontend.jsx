import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard,
  FileText,
  UploadCloud,
  Settings,
  CheckCircle,
  Sparkles,
  Download,
  Trash2,
  Plus,
  FileSpreadsheet,
  ChevronRight,
  RefreshCw,
  BoxSelect,
  Maximize2
} from 'lucide-react';

const defaultApiBase =
  (typeof window !== 'undefined' && `${window.location.origin}/api`) ||
  'http://localhost:8000/api';
const API_BASE =
  (typeof window !== 'undefined' && window.__CLEAN_SYNC_API_BASE__) ||
  defaultApiBase;
const ALL_DAYS = ['MAN', 'TIRS', 'ONS', 'TORS', 'FRE', 'LØR', 'SØN'];
const PLAN_STATUS_POLL_MS = 10000;
const MIN_WAIT_MS = 60 * 1000;
const getLoadingMessage = () =>
  Math.random() < 0.25 ? 'Analyserer plantegning' : 'Genererer renholdsplan';
const safeJsonParse = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const formatDetailList = (detail) => {
  if (!Array.isArray(detail)) return '';
  return detail
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (typeof item.msg === 'string') return item.msg;
      if (typeof item.message === 'string') return item.message;
      if (typeof item.detail === 'string') return item.detail;
      try {
        return JSON.stringify(item);
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join(', ');
};
const buildApiErrorMessage = (payload, fallbackMessage, status, rawText) => {
  const fallback =
    fallbackMessage ||
    (status && status >= 500
      ? 'Serverfeil. Prøv igjen senere.'
      : 'Forespørselen mislyktes.');
  if (payload) {
    if (typeof payload.detail === 'string') {
      return payload.detail;
    }
    if (Array.isArray(payload.detail)) {
      const formatted = formatDetailList(payload.detail);
      if (formatted) return formatted;
    }
    if (payload.detail && typeof payload.detail === 'object') {
      let message = payload.detail.message || payload.detail.error || fallback;
      if (payload.detail.retryable && message && !/prøv igjen/i.test(message)) {
        message = `${message} Prøv igjen om litt.`;
      }
      return message;
    }
    if (typeof payload.message === 'string') {
      return payload.message;
    }
    if (payload.error) {
      if (typeof payload.error === 'string') {
        return payload.error;
      }
      if (payload.error && typeof payload.error.message === 'string') {
        return payload.error.message;
      }
    }
  }
  if (rawText && rawText.trim()) {
    return rawText.trim();
  }
  return `${fallback}${status ? ` (kode ${status})` : ''}`;
};
const parseApiResponse = async (response, fallbackMessage) => {
  const rawText = await response.text();
  const payload = safeJsonParse(rawText);
  if (!response.ok) {
    throw new Error(buildApiErrorMessage(payload, fallbackMessage, response.status, rawText));
  }
  return payload ?? {};
};

const Button = ({ children, variant = 'primary', className = '', onClick, disabled, icon: Icon, type = 'button' }) => {
  const baseStyle = 'flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow-md',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100'
  };

  return (
    <button
      type={type}
      className={`${baseStyle} ${variants[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4 mr-2" />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 ${className}`}>
    {children}
  </div>
);

const ProgressBar = ({ progress, label }) => (
  <div className="w-full">
    <div className="flex justify-between mb-1">
      <span className="text-sm font-medium text-indigo-700">{label}</span>
      <span className="text-sm font-medium text-indigo-700">{progress}%</span>
    </div>
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div
        className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      ></div>
    </div>
  </div>
);

const ErrorBanner = ({ message }) => (
  <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-4 text-sm">
    {message}
  </div>
);

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
};

const normalizePlanEntries = (plan) => {
  if (!plan || !plan.entries) return [];
  return plan.entries.map((entry, index) => ({
    id: index + 1,
    room_name: entry.room_name || entry.room || 'Ukjent rom',
    area_m2: entry.area_m2 ?? null,
    floor: entry.floor || '1 ETG',
    description: entry.description || '',
    notes: entry.notes || '',
    frequency: ALL_DAYS.reduce((acc, day) => ({
      ...acc,
      [day]: Boolean(entry.frequency ? entry.frequency[day] : false)
    }), {})
  }));
};

const PlanTable = ({ rows, onUpdateRow, onToggleDay, readOnly = false }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
          <th className="p-3">AREAL</th>
          <th className="p-3">BESKRIVELSE</th>
          <th className="p-3 w-24">ETG</th>
          {ALL_DAYS.map((day) => (
            <th key={day} className="p-3 w-16 text-center">{day}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-indigo-50/30">
            <td className="p-3 align-top">
              <div className="text-sm font-medium text-gray-900">
                {readOnly ? (
                  row.room_name
                ) : (
                  <input
                    className="w-full bg-transparent border border-transparent focus:border-indigo-200 rounded-md px-2 py-1"
                    value={row.room_name}
                    onChange={(e) => onUpdateRow(row.id, 'room_name', e.target.value)}
                  />
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {readOnly ? (
                  `${row.area_m2 ?? '--'} m²`
                ) : (
                  <input
                    type="number"
                    className="w-full bg-transparent border border-transparent focus:border-indigo-200 rounded-md px-2 py-1 text-xs"
                    value={row.area_m2 ?? ''}
                    placeholder="m²"
                    onChange={(e) => onUpdateRow(row.id, 'area_m2', e.target.value ? Number(e.target.value) : null)}
                  />
                )}
              </div>
            </td>
            <td className="p-3 text-sm text-gray-600">
              {readOnly ? (
                row.description
              ) : (
                <textarea
                  className="w-full bg-transparent border border-transparent focus:border-indigo-200 rounded-md px-2 py-1"
                  value={row.description}
                  rows={3}
                  onChange={(e) => onUpdateRow(row.id, 'description', e.target.value)}
                />
              )}
            </td>
            <td className="p-3 align-top text-sm text-gray-600">
              {readOnly ? (
                row.floor
              ) : (
                <input
                  className="w-full bg-transparent border border-transparent focus:border-indigo-200 rounded-md px-2 py-1"
                  value={row.floor}
                  onChange={(e) => onUpdateRow(row.id, 'floor', e.target.value)}
                />
              )}
            </td>
            {ALL_DAYS.map((day) => (
              <td key={day} className="p-3 text-center">
                <button
                  type="button"
                  className={`w-8 h-8 rounded-md border text-xs font-semibold ${row.frequency?.[day] ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-400'} ${readOnly ? 'cursor-default' : 'hover:border-indigo-400'}`}
                  onClick={() => !readOnly && onToggleDay(row.id, day)}
                  disabled={readOnly}
                >
                  {row.frequency?.[day] ? 'X' : ''}
                </button>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const GeneratorView = () => {
  const [step, setStep] = useState(1);
  const [uploads, setUploads] = useState([]);
  const [templateMeta, setTemplateMeta] = useState(null);
  const [options, setOptions] = useState({
    hasRoomNames: true,
    hasArea: true,
    referenceLabel: '',
    referenceWidth: '',
    referenceUnit: 'm'
  });
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStartTime, setProcessingStartTime] = useState(null);
  const [planRows, setPlanRows] = useState([]);
  const [planMeta, setPlanMeta] = useState(null);
  const [docxUrl, setDocxUrl] = useState('');
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historySelection, setHistorySelection] = useState(null);
  const [isFetchingHistoryPlan, setIsFetchingHistoryPlan] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const planStatusTimerRef = useRef(null);

  const formatHistoryTimestamp = (value) => {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('no-NO');
    } catch {
      return value;
    }
  };

  const fileIds = useMemo(() => uploads.map((file) => file.id), [uploads]);
  const jobHeadline =
    activeJob?.status === 'pending'
      ? 'Jobb i kø...'
      : activeJob?.status === 'running'
        ? 'Jobb kjører...'
        : '';
  const loadingHeadline = statusMessage || jobHeadline || 'Genererer renholdsplan';
  const uploadCountDescription = fileIds.length === 1 ? '1 plantegning' : `${fileIds.length} plantegninger`;

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch(`${API_BASE}/plans?limit=10`);
      if (!response.ok) {
        throw new Error('Kunne ikke hente tidligere genereringer');
      }
      const data = await response.json();
      const mapped = (data.plans || []).map((plan) => ({
        ...plan,
        docx_url: plan.docx_url ? `${API_BASE}${plan.docx_url}` : null
      }));
      setHistory(mapped);
    } catch (err) {
      setHistoryError(err.message || 'Feil ved henting av historikk');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const stopPlanPolling = useCallback(() => {
    if (planStatusTimerRef.current) {
      clearInterval(planStatusTimerRef.current);
      planStatusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPlanPolling();
  }, [stopPlanPolling]);

  const pollJobStatus = useCallback(
    (jobId) => {
      const run = async () => {
        try {
          const response = await fetch(`${API_BASE}/generate-plan/status/${jobId}`);
          const data = await parseApiResponse(response, 'Kunne ikke hente jobbstatus');
          setActiveJob(data.job);
          if (data.job.status === 'success') {
            stopPlanPolling();
            setPlanRows(normalizePlanEntries(data.plan));
            setPlanMeta({
              totalArea: data.plan?.total_area_m2,
              templateName: data.plan?.template_name
            });
            setDocxUrl(data.docx_url ? `${API_BASE}${data.docx_url}` : '');
            setProcessingProgress(100);
            setProcessingStartTime(null);
            setStep(4);
            setIsGenerating(false);
            setStatusMessage('');
            setActiveJob(null);
            fetchHistory();
          } else if (data.job.status === 'failed') {
            stopPlanPolling();
            const jobMessage =
              data.job.detail?.message ||
              data.job.detail?.error ||
              data.job.message ||
              'Generering mislyktes';
            setError(jobMessage);
            setProcessingProgress(0);
            setProcessingStartTime(null);
            setIsGenerating(false);
            setStatusMessage('');
            setActiveJob(null);
            setStep(2);
          }
        } catch (err) {
          stopPlanPolling();
          setError(err.message);
          setProcessingProgress(0);
          setProcessingStartTime(null);
          setIsGenerating(false);
          setStatusMessage('');
          setActiveJob(null);
          setStep(2);
        }
      };
      run();
      const schedule = typeof window === 'undefined' ? setInterval : window.setInterval;
      planStatusTimerRef.current = schedule(run, PLAN_STATUS_POLL_MS);
    },
    [fetchHistory, stopPlanPolling]
  );

  const DEFAULT_WAIT_MS = 3 * 60 * 1000;
  const estimatedDurationMs = useMemo(() => {
    const runs = history
      .filter(
        (item) =>
          item.source === 'generator' &&
          typeof item.generation_seconds === 'number' &&
          !Number.isNaN(item.generation_seconds)
      )
      .slice(0, 20);
    if (!runs.length) {
      return DEFAULT_WAIT_MS;
    }
    const avgSeconds =
      runs.reduce((sum, item) => sum + (item.generation_seconds || 0), 0) / runs.length;
    const toMs = (seconds) => Math.max(MIN_WAIT_MS, Math.round(seconds * 1000));
    const matching = runs.filter(
      (item) =>
        typeof item.metadata?.file_count === 'number' &&
        item.metadata.file_count === fileIds.length &&
        fileIds.length > 0
    );
    if (matching.length) {
      const matchAvgSeconds =
        matching.reduce((sum, item) => sum + (item.generation_seconds || 0), 0) /
        matching.length;
      return toMs(matchAvgSeconds);
    }
    const withCounts = runs.filter(
      (item) => typeof item.metadata?.file_count === 'number' && item.metadata.file_count > 0
    );
    if (withCounts.length && fileIds.length > 0) {
      const totalSeconds = withCounts.reduce(
        (sum, item) => sum + (item.generation_seconds || 0),
        0
      );
      const totalFiles = withCounts.reduce(
        (sum, item) => sum + (item.metadata?.file_count || 0),
        0
      );
      if (totalFiles > 0) {
        const perFileSeconds = totalSeconds / totalFiles;
        return toMs(perFileSeconds * fileIds.length);
      }
    }
    return toMs(avgSeconds);
  }, [history, fileIds.length]);
  const estimatedMinutes = Math.max(1, Math.round(estimatedDurationMs / 60000));

  const handleFileUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selectedFiles.length) return;
    setError(null);
    setIsUploading(true);
    try {
      const body = new FormData();
      selectedFiles.forEach((file) => body.append('files', file));
      const response = await fetch(`${API_BASE}/upload/floorplans`, {
        method: 'POST',
        body
      });
      const data = await parseApiResponse(response, 'Kunne ikke laste opp plantegninger');
      const mapped = data.file_ids.map((id, index) => ({
        id,
        name: selectedFiles[index].name,
        size: selectedFiles[index].size
      }));
      setUploads((prev) => [...prev, ...mapped]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = (id) => {
    setUploads((prev) => prev.filter((file) => file.id !== id));
  };

  const clearFiles = () => {
    stopPlanPolling();
    setActiveJob(null);
    setUploads([]);
    setPlanRows([]);
    setPlanMeta(null);
    setDocxUrl('');
    setTemplateMeta(null);
    setError(null);
    setStatusMessage('');
    setProcessingProgress(0);
    setProcessingStartTime(null);
    setHistorySelection(null);
    setStep(1);
  };

  const handleTemplateUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch(`${API_BASE}/upload/template`, {
        method: 'POST',
        body
      });
      const data = await parseApiResponse(response, 'Kunne ikke laste opp mal');
      setTemplateMeta({ ...data, originalName: file.name });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGeneratePlan = async () => {
    if (!fileIds.length) {
      setError('Last opp minst én plantegning før du genererer en plan');
      return;
    }
    setError(null);
    stopPlanPolling();
    setActiveJob(null);
    setIsGenerating(true);
    setProcessingProgress(5);
    setProcessingStartTime(Date.now());
    const fileDescriptor = fileIds.length > 1 ? ` for ${fileIds.length} plantegninger` : '';
    setStatusMessage(`Jobb startet – anslått tid ${estimatedMinutes} min${fileDescriptor}.`);
    setStep(3);

    const payload = {
      file_ids: fileIds,
      template_id: templateMeta?.template_id || null,
      options: {
        has_room_names: options.hasRoomNames,
        has_area: options.hasArea,
        reference_label: options.referenceLabel || null,
        reference_width: options.referenceWidth ? Number(options.referenceWidth) : null,
        reference_unit: options.referenceUnit
      }
    };

    try {
      const response = await fetch(`${API_BASE}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response, 'Kunne ikke starte jobben');
      setActiveJob(data.job);
      pollJobStatus(data.job.id);
    } catch (err) {
      setError(err.message);
      setProcessingProgress(0);
      setProcessingStartTime(null);
      setIsGenerating(false);
      setStatusMessage('');
      setStep(2);
    }
  };

  const updateRow = (rowId, field, value) => {
    setPlanRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)));
  };

  const toggleDay = (rowId, day) => {
    setPlanRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              frequency: { ...row.frequency, [day]: !row.frequency?.[day] }
            }
          : row
      )
    );
  };

  const addRow = () => {
    const newId = planRows.length + 1;
    setPlanRows((prev) => [
      ...prev,
      {
        id: newId,
        room_name: `Nytt område ${newId}`,
        area_m2: null,
        floor: '1 ETG',
        description: '',
        notes: '',
        frequency: ALL_DAYS.reduce((acc, day) => ({ ...acc, [day]: false }), {})
      }
    ]);
  };

  const downloadDocx = () => {
    if (!docxUrl) return;
    window.open(docxUrl, '_blank', 'noopener');
  };

  const loadHistoryPlan = async (planId) => {
    setIsFetchingHistoryPlan(planId);
    setError('');
    setStatusMessage('');
    setProcessingProgress(0);
    setProcessingStartTime(null);
    try {
      const response = await fetch(`${API_BASE}/plans/${planId}`);
      const data = await parseApiResponse(response, 'Kunne ikke hente lagret plan');
      setPlanRows(normalizePlanEntries(data.plan));
      setPlanMeta({
        totalArea: data.plan.total_area_m2,
        templateName: data.plan.template_name
      });
      setDocxUrl(data.summary?.docx_url ? `${API_BASE}${data.summary.docx_url}` : '');
      setHistorySelection(planId);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsFetchingHistoryPlan(null);
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!processingStartTime || step !== 3 || !isGenerating) {
      return;
    }
    const totalMs = estimatedDurationMs || DEFAULT_WAIT_MS;
    const interval = setInterval(() => {
      const elapsed = Date.now() - processingStartTime;
      const targetProgress = Math.min(95, 5 + (elapsed / totalMs) * 90);
      setProcessingProgress((prev) => {
        if (targetProgress <= prev) {
          return prev;
        }
        return Math.round(targetProgress);
      });
      if (targetProgress >= 95) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [processingStartTime, step, isGenerating, estimatedDurationMs]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-center mb-8">
        {[
          { id: 1, label: 'Upload' },
          { id: 2, label: 'Configure' },
          { id: 3, label: 'Process' },
          { id: 4, label: 'Review' }
        ].map((stage, idx) => (
          <div key={stage.id} className="flex items-center">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${step >= stage.id ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step > stage.id ? <CheckCircle className="w-5 h-5" /> : stage.id}
            </div>
            <span className={`ml-2 text-sm font-medium ${step >= stage.id ? 'text-indigo-900' : 'text-gray-400'}`}>{stage.label}</span>
            {idx < 3 && <div className={`w-12 h-0.5 mx-4 ${step > stage.id ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {step === 1 && (
        <Card className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800">Upload Floor Plans</h2>
            <p className="text-gray-500 mt-2">Legg inn PDF eller bilde for å starte renholdsplanen.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center bg-gray-50 hover:bg-indigo-50 hover:border-indigo-300 transition-colors cursor-pointer group relative">
              <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileUpload} accept="image/*,.pdf" />
              <div className="bg-white p-4 rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8 text-indigo-600" />
              </div>
              <p className="font-medium text-gray-700">Klikk eller dra plantegninger hit</p>
              <p className="text-sm text-gray-400 mt-1">PDF, JPG, PNG støttes</p>
            </div>
            <div className="flex flex-col h-full">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-700">Valgte filer ({uploads.length})</h3>
                {uploads.length > 0 && (
                  <Button variant="ghost" className="text-xs text-red-500" onClick={clearFiles} disabled={isUploading}>
                    Tøm
                  </Button>
                )}
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl p-4 overflow-y-auto max-h-[300px]">
                {uploads.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <FileText className="w-10 h-10 mb-2 opacity-20" />
                    <p className="text-sm">Ingen filer lastet opp</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {uploads.map((file) => (
                      <li key={file.id} className="flex items-center justify-between bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                        <div className="flex items-center truncate">
                          <FileText className="w-4 h-4 text-indigo-500 mr-3 flex-shrink-0" />
                          <div>
                            <span className="text-sm text-gray-700 block truncate max-w-[200px]">{file.name}</span>
                            <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>
                          </div>
                        </div>
                        <button onClick={() => removeFile(file.id)} className="text-gray-400 hover:text-red-500" disabled={isUploading}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Valgfritt: bruk eksisterende renholdsplan (V3)</label>
                  <div className="flex items-center">
                    <label className="flex-1 cursor-pointer">
                      <input type="file" className="hidden" onChange={handleTemplateUpload} />
                      <div className="flex items-center px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-sm text-gray-600">
                        <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
                        {templateMeta ? templateMeta.filename : 'Last opp renholdsmal...'}
                      </div>
                    </label>
                    {templateMeta && (
                      <button onClick={() => setTemplateMeta(null)} className="ml-2 text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {templateMeta && (
                    <p className="text-xs text-gray-500 mt-1">Bruker {templateMeta.originalName} → {templateMeta.filename}</p>
                  )}
                </div>
                <Button className="w-full" disabled={!uploads.length || isUploading} onClick={() => setStep(2)} icon={ChevronRight}>
                  Neste steg
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="max-w-2xl mx-auto p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Konfigurasjon</h2>
          <div className="space-y-6">
            <div
              className="flex items-start p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => setOptions((prev) => ({ ...prev, hasRoomNames: !prev.hasRoomNames }))}
            >
              <div
                className={`mt-1 w-5 h-5 rounded border flex items-center justify-center mr-4 ${options.hasRoomNames ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white'}`}
              >
                {options.hasRoomNames && <CheckCircle className="w-3.5 h-3.5 text-white" />}
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Romnavn finnes på tegningen</h4>
                <p className="text-sm text-gray-500">Systemet bruker rometiketter direkte.</p>
              </div>
            </div>

            <div
              className="flex items-start p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => setOptions((prev) => ({ ...prev, hasArea: !prev.hasArea }))}
            >
              <div
                className={`mt-1 w-5 h-5 rounded border flex items-center justify-center mr-4 ${options.hasArea ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white'}`}
              >
                {options.hasArea && <CheckCircle className="w-3.5 h-3.5 text-white" />}
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Areal (m²) er markert</h4>
                <p className="text-sm text-gray-500">Dersom ikke, oppgi et referansemål.</p>
              </div>
            </div>

            {!options.hasArea && (
              <div className="bg-indigo-50 p-6 rounded-lg border border-indigo-100 animate-in fade-in slide-in-from-top-4">
                <div className="flex items-center mb-2 text-indigo-900 font-medium">
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Referansemål nødvendig
                </div>
                <p className="text-sm text-indigo-700 mb-4">Gi et kjent mål slik at systemet kan skalere tegningen.</p>
                <div className="flex flex-col md:flex-row gap-4">
                  <input
                    type="text"
                    placeholder="F.eks. møterom bredde"
                    className="flex-1 border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 p-2 border"
                    value={options.referenceLabel}
                    onChange={(e) => setOptions((prev) => ({ ...prev, referenceLabel: e.target.value }))}
                  />
                  <div className="flex items-center w-full md:w-48">
                    <input
                      type="number"
                      placeholder="0.00"
                      className="flex-1 border-gray-300 rounded-l-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 p-2 border border-r-0"
                      value={options.referenceWidth}
                      onChange={(e) => setOptions((prev) => ({ ...prev, referenceWidth: e.target.value }))}
                    />
                    <select
                      className="bg-gray-100 border border-gray-300 border-l-0 px-3 py-2 rounded-r-md text-gray-500 text-sm"
                      value={options.referenceUnit}
                      onChange={(e) => setOptions((prev) => ({ ...prev, referenceUnit: e.target.value }))}
                    >
                      <option value="m">m</option>
                      <option value="cm">cm</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-8 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)} disabled={isGenerating || isUploading}>
              Tilbake
            </Button>
            <Button onClick={handleGeneratePlan} icon={Sparkles} disabled={isGenerating || isUploading}>
              Generer plan
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="max-w-xl mx-auto p-12 text-center">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
            <Sparkles className="absolute inset-0 m-auto text-indigo-600 w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">{loadingHeadline}</h2>
          <p className="text-gray-500 mb-8">Vi jobber med {uploadCountDescription} du lastet opp.</p>
          <ProgressBar progress={processingProgress} label="Fremdrift" />
          <p className="text-sm text-gray-500 mt-4">
            Forventet tid ca. {estimatedMinutes} min{fileIds.length > 1 ? ` for ${fileIds.length} plantegninger` : ''}.
          </p>
        </Card>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Gjennomgå renholdsplan</h2>
              <p className="text-gray-500">
                Totalt {planRows.length} områder, {planMeta?.totalArea?.toFixed(0) || 0} m² dekket.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={clearFiles} icon={RefreshCw}>
                Start på nytt
              </Button>
              <Button onClick={downloadDocx} icon={Download} disabled={!docxUrl}>
                Last ned DOCX
              </Button>
            </div>
          </div>
          <Card className="overflow-hidden">
            <PlanTable rows={planRows} onUpdateRow={updateRow} onToggleDay={toggleDay} />
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center flex-wrap gap-2">
              <Button variant="ghost" icon={Plus} onClick={addRow}>
                Legg til område
              </Button>
              <p className="text-sm text-gray-500">
                Basert på instruksjonene satt i adminpanelet.
              </p>
            </div>
          </Card>
          {planMeta && (
            <Card className="p-6">
              <h3 className="font-semibold text-gray-800 mb-2">Oppsummering</h3>
              <p className="text-sm text-gray-600">
                Planen dekker ca. {planMeta.totalArea?.toFixed(0) || '0'} m².
                {planMeta.templateName && ` Mal: ${planMeta.templateName}.`}
              </p>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-8">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800">Tidligere genereringer</h3>
            <p className="text-sm text-gray-500">Åpne eller last ned tidligere planer uten å kjøre analysen på nytt.</p>
          </div>
          <Button variant="ghost" onClick={fetchHistory} disabled={historyLoading}>
            Oppdater
          </Button>
        </div>
        {historyError && <p className="text-sm text-red-500 mb-3">{historyError}</p>}
        {historyLoading ? (
          <p className="text-sm text-gray-500">Laster historikk...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">Ingen lagrede planer ennå.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((item) => (
              <li key={item.id} className="py-3 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {item.metadata?.template_id ? 'Generator (mal)' : item.source === 'converter' ? 'Konvertering' : item.source === 'batch' ? 'Batch' : 'Generator'}
                  </p>
                  <p className="text-xs text-gray-500">{formatHistoryTimestamp(item.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {item.docx_url && (
                    <Button variant="ghost" className="text-xs" onClick={() => openHistoryDocx(item.docx_url)}>
                      DOCX
                    </Button>
                  )}
                  <Button
                    variant={historySelection === item.id ? 'secondary' : 'primary'}
                    className="text-xs"
                    onClick={() => loadHistoryPlan(item.id)}
                    disabled={isFetchingHistoryPlan === item.id}
                  >
                    {isFetchingHistoryPlan === item.id ? 'Åpner...' : 'Vis plan'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

const ConverterView = () => {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [planMeta, setPlanMeta] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState(null);

  const handleConvert = async () => {
    if (!file) {
      setError('Velg en fil for konvertering');
      return;
    }
    setError(null);
    setIsConverting(true);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch(`${API_BASE}/convert-plan`, {
        method: 'POST',
        body
      });
      const data = await parseApiResponse(response, 'Konvertering mislyktes');
      setRows(normalizePlanEntries(data.plan));
      setPlanMeta({ totalArea: data.plan.total_area_m2, templateName: data.plan.template_name });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {error && <ErrorBanner message={error} />}
      <Card className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div>
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <UploadCloud className="w-5 h-5 mr-2 text-indigo-600" />
            Last opp ekstern renholdsplan
          </h3>
          <div className="border-2 border-dashed border-gray-300 rounded-lg h-64 flex flex-col items-center justify-center bg-gray-50 hover:bg-white transition-colors cursor-pointer relative">
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setFile(e.target.files?.[0] || null)} accept=".pdf,.doc,.docx,.txt" />
            {file ? (
              <div className="text-center">
                <p className="text-gray-700 font-medium">{file.name}</p>
                <p className="text-sm text-gray-400 mt-1">{formatBytes(file.size)}</p>
              </div>
            ) : (
              <>
                <FileText className="w-10 h-10 text-gray-300 mb-3" />
                <p className="font-medium text-gray-600">Velg fil</p>
                <p className="text-xs text-gray-400 mt-1">DOCX eller PDF</p>
              </>
            )}
          </div>
          <div className="mt-6">
            <Button className="w-full" onClick={handleConvert} disabled={isConverting || !file} icon={Sparkles}>
              {isConverting ? 'Konverterer...' : 'Konverter til Cleansync standard'}
            </Button>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <Sparkles className="w-4 h-4 mr-2 text-indigo-600" />
            Resultat
          </h3>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">Konvertert plan vises her.</p>
          ) : (
            <Card className="border border-indigo-100">
              <PlanTable rows={rows} readOnly />
            </Card>
          )}
          {planMeta && (
            <p className="text-xs text-gray-500 mt-2">Ca. {planMeta.totalArea?.toFixed(0) || 0} m² konvertert.</p>
          )}
        </div>
      </Card>
    </div>
  );
};

const BatchView = () => {
  const [uploads, setUploads] = useState([]);
  const [options, setOptions] = useState({ hasRoomNames: true, hasArea: true });
  const [batchJob, setBatchJob] = useState(null);
  const [batchPlans, setBatchPlans] = useState([]);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const fileIds = useMemo(() => uploads.map((file) => file.id), [uploads]);

  useEffect(() => {
    if (!batchJob || ['success', 'failed'].includes(batchJob.status)) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/batch/status/${batchJob.id}`);
        const data = await parseApiResponse(response, 'Kunne ikke hente batchstatus');
        setBatchJob(data.job);
        if (data.job.status === 'failed' && data.job.message) {
          setError(data.job.message);
          return;
        }
        if (data.job.status === 'success') {
          const resultsResponse = await fetch(`${API_BASE}/batch/results/${data.job.id}`);
          const results = await parseApiResponse(resultsResponse, 'Kunne ikke hente batchresultater');
          setBatchPlans(results.plans || []);
        }
      } catch (err) {
        setError(err.message);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [batchJob]);

  const handleBatchUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selectedFiles.length) return;
    setError(null);
    setIsUploading(true);
    try {
      const body = new FormData();
      selectedFiles.forEach((file) => body.append('files', file));
      const response = await fetch(`${API_BASE}/upload/floorplans`, {
        method: 'POST',
        body
      });
      const data = await parseApiResponse(response, 'Opplasting feilet');
      const mapped = data.file_ids.map((id, index) => ({
        id,
        name: selectedFiles[index].name,
        size: selectedFiles[index].size
      }));
      setUploads((prev) => [...prev, ...mapped]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const startBatchJob = async () => {
    if (!fileIds.length) {
      setError('Ingen filer i køen');
      return;
    }
    setError(null);
    const payload = {
      file_ids: fileIds,
      options: {
        has_room_names: options.hasRoomNames,
        has_area: options.hasArea,
        reference_unit: 'm'
      }
    };
    try {
      const response = await fetch(`${API_BASE}/batch/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response, 'Kunne ikke starte batchjobb');
      setBatchJob(data.job);
      setBatchPlans([]);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {error && <ErrorBanner message={error} />}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Batch Processing</h2>
            <p className="text-gray-500">Test opptil 200 tegninger/planer.</p>
          </div>
          <Button icon={Plus} onClick={startBatchJob} disabled={!fileIds.length || isUploading}>
            Start batchjobb
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center bg-gray-50 hover:bg-white transition-colors cursor-pointer relative">
            <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleBatchUpload} accept="image/*,.pdf" />
            <UploadCloud className="w-10 h-10 text-indigo-600 mb-3" />
            <p className="font-medium text-gray-700">Last opp filer til batch ({uploads.length})</p>
            <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <h4 className="font-semibold text-gray-700 mb-2">Alternativer</h4>
            <label className="flex items-center text-sm text-gray-600">
              <input
                type="checkbox"
                className="mr-2"
                checked={options.hasRoomNames}
                onChange={() => setOptions((prev) => ({ ...prev, hasRoomNames: !prev.hasRoomNames }))}
              />
              Romnavn på tegningene
            </label>
            <label className="flex items-center text-sm text-gray-600 mt-2">
              <input
                type="checkbox"
                className="mr-2"
                checked={options.hasArea}
                onChange={() => setOptions((prev) => ({ ...prev, hasArea: !prev.hasArea }))}
              />
              Areal (m²) tilstede
            </label>
            {batchJob && (
              <div className="mt-4 text-sm text-gray-600">
                Status: <span className="font-semibold">{batchJob.status}</span> ({batchJob.processed_files}/{batchJob.total_files})
                {batchJob.message && (
                  <p className="text-xs text-gray-500 mt-1">
                    {batchJob.status === 'failed' ? 'Feil:' : 'Info:'} {batchJob.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Opplastede filer</h3>
        {uploads.length === 0 ? (
          <p className="text-sm text-gray-500">Ingen filer i batchkøen.</p>
        ) : (
          <ul className="space-y-2">
            {uploads.map((file) => (
              <li key={file.id} className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-100">
                <div>
                  <p className="text-sm text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-400">{formatBytes(file.size)}</p>
                </div>
                <span className="text-xs text-gray-500">ID: {file.id.slice(-6)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {batchPlans.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Resultater</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {batchPlans.map((plan, index) => (
              <div key={`${plan.template_name || 'plan'}-${index}`} className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Plan {index + 1}</p>
                <p className="text-xs text-gray-500 mb-2">{plan.entries?.length || 0} rom • {plan.total_area_m2?.toFixed(0) || 0} m²</p>
                <div className="text-xs text-gray-600 space-y-1">
                  {plan.entries?.slice(0, 3).map((entry) => (
                    <div key={entry.room_name} className="flex justify-between">
                      <span>{entry.room_name}</span>
                      <span>{entry.area_m2 ?? '--'} m²</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

const AdminDashboard = () => {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', label: '', value: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [promptValue, setPromptValue] = useState('');
  const [promptMeta, setPromptMeta] = useState({ updated_at: null, is_overridden: false });
  const [isPromptLoading, setIsPromptLoading] = useState(true);
  const [isPromptSaving, setIsPromptSaving] = useState(false);
  const [geminiConfig, setGeminiConfig] = useState({ temperature: '', top_p: '', media_resolution: '' });
  const [isGeminiConfigLoading, setIsGeminiConfigLoading] = useState(true);
  const [isGeminiConfigSaving, setIsGeminiConfigSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/api-keys`);
      if (!response.ok) {
        throw new Error('Kunne ikke hente API-nøkler');
      }
      const data = await response.json();
      setApiKeys(data.api_keys || []);
    } catch (err) {
      setError(err.message || 'Ukjent feil ved henting');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrompt = useCallback(async () => {
    setIsPromptLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/system-prompt`);
      if (!response.ok) {
        throw new Error('Kunne ikke hente systemprompt');
      }
      const data = await response.json();
      setPromptValue(data.prompt || '');
      setPromptMeta({ updated_at: data.updated_at, is_overridden: data.is_overridden });
    } catch (err) {
      setError(err.message || 'Ukjent feil ved henting av systemprompt');
    } finally {
      setIsPromptLoading(false);
    }
  }, []);

  const loadGeminiConfig = useCallback(async () => {
    setIsGeminiConfigLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/gemini-config`);
      if (!response.ok) {
        throw new Error('Kunne ikke hente Gemini-konfigurasjon');
      }
      const data = await response.json();
      const cfg = data.config || {};
      setGeminiConfig({
        temperature: cfg.temperature ?? '',
        top_p: cfg.top_p ?? '',
        media_resolution: cfg.media_resolution || ''
      });
    } catch (err) {
      setError(err.message || 'Ukjent feil ved henting av Gemini-konfigurasjon');
    } finally {
      setIsGeminiConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    loadPrompt();
    loadGeminiConfig();
  }, [fetchKeys, loadPrompt, loadGeminiConfig]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.name.trim() || !form.value.trim()) {
      setError('Navn og nøkkelverdi må fylles ut.');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        value: form.value.trim(),
        label: form.label.trim() || undefined
      };
      const response = await fetch(`${API_BASE}/admin/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error('Kunne ikke lagre API-nøkkelen');
      }
      setForm({ name: '', label: '', value: '' });
      setMessage('API-nøkkelen er lagret.');
      await fetchKeys();
    } catch (err) {
      setError(err.message || 'Ukjent feil ved lagring');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name) => {
    if (!name) return;
    const shouldDelete = typeof window === 'undefined' ? true : window.confirm('Er du sikker på at du vil fjerne denne API-nøkkelen?');
    if (!shouldDelete) {
      return;
    }
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/admin/api-keys/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Kunne ikke slette API-nøkkelen');
      }
      setMessage('API-nøkkelen er slettet.');
      await fetchKeys();
    } catch (err) {
      setError(err.message || 'Ukjent feil ved sletting');
    }
  };

  const handlePromptSave = async () => {
    setError('');
    setMessage('');
    try {
      setIsPromptSaving(true);
      const response = await fetch(`${API_BASE}/admin/system-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptValue })
      });
      if (!response.ok) {
        throw new Error('Kunne ikke lagre systemprompt');
      }
      const data = await response.json();
      setPromptValue(data.prompt || '');
      setPromptMeta({ updated_at: data.updated_at, is_overridden: data.is_overridden });
      setMessage('Systemprompten er lagret.');
    } catch (err) {
      setError(err.message || 'Ukjent feil ved lagring av systemprompt');
    } finally {
      setIsPromptSaving(false);
    }
  };

  const handlePromptReset = async () => {
    setError('');
    setMessage('');
    try {
      setIsPromptSaving(true);
      const response = await fetch(`${API_BASE}/admin/system-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_default: true })
      });
      if (!response.ok) {
        throw new Error('Kunne ikke tilbakestille systemprompt');
      }
      const data = await response.json();
      setPromptValue(data.prompt || '');
      setPromptMeta({ updated_at: data.updated_at, is_overridden: data.is_overridden });
      setMessage('Systemprompten er tilbakestilt.');
    } catch (err) {
      setError(err.message || 'Ukjent feil ved tilbakestilling av systemprompt');
    } finally {
      setIsPromptSaving(false);
    }
  };

  const handleGeminiConfigSave = async () => {
    setError('');
    setMessage('');
    try {
      setIsGeminiConfigSaving(true);
      const payload = {
        temperature: geminiConfig.temperature === '' ? null : Number(geminiConfig.temperature),
        top_p: geminiConfig.top_p === '' ? null : Number(geminiConfig.top_p),
        media_resolution: geminiConfig.media_resolution || null
      };
      const response = await fetch(`${API_BASE}/admin/gemini-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error('Kunne ikke lagre Gemini-konfigurasjon');
      }
      const data = await response.json();
      const cfg = data.config || {};
      setGeminiConfig({
        temperature: cfg.temperature ?? '',
        top_p: cfg.top_p ?? '',
        media_resolution: cfg.media_resolution || ''
      });
      setMessage('Gemini-konfigurasjonen er lagret.');
    } catch (err) {
      setError(err.message || 'Ukjent feil ved lagring av Gemini-konfigurasjon');
    } finally {
      setIsGeminiConfigSaving(false);
    }
  };

  const maskValue = (key) => {
    if (!key.configured) {
      return 'Ikke konfigurert';
    }
    return `•••• ${key.last_four || ''}`;
  };

  const formatUpdated = (value) => {
    if (!value) return 'Aldri';
    try {
      return new Date(value).toLocaleString('no-NO');
    } catch {
      return value;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto py-12 px-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Admin</p>
            <h1 className="text-3xl font-bold mt-2">API-nøkler</h1>
            <p className="text-slate-400 mt-2 max-w-2xl text-sm">
              Konfigurer API-nøkler uten å endre servermiljøet. Alle nøkler lagres lokalt på serveren.
            </p>
          </div>
          <a href="/" className="text-sm text-indigo-200 border border-indigo-500/50 px-4 py-2 rounded-lg hover:bg-indigo-500/10 transition">
            ← Tilbake til appen
          </a>
        </div>

        {(error || message) && (
          <div className={`${error ? 'bg-red-500/10 border-red-500/40 text-red-200' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'} border rounded-lg px-4 py-3 text-sm`}>
            {error || message}
          </div>
        )}

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Systemprompt</h2>
              <p className="text-slate-400 text-sm mt-1">
                Rediger instruksjonsteksten som sendes til AI-motoren før alle forespørsler.
              </p>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${promptMeta.is_overridden ? 'text-amber-200 border-amber-400/40 bg-amber-400/10' : 'text-slate-400 border-slate-600'}`}>
              {promptMeta.is_overridden ? 'Egendefinert' : 'Standard'}
            </span>
          </div>
          {isPromptLoading ? (
            <p className="text-sm text-slate-400">Laster systemprompt...</p>
          ) : (
            <>
              <textarea
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm focus:border-indigo-500 focus:ring-0 min-h-[200px]"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
              />
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Sist oppdatert: {promptMeta.updated_at ? formatUpdated(promptMeta.updated_at) : 'Original fra fil'}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={handlePromptReset} disabled={isPromptSaving || isPromptLoading}>
                    Tilbakestill
                  </Button>
                  <Button onClick={handlePromptSave} disabled={isPromptSaving || isPromptLoading}>
                    {isPromptSaving ? 'Lagrer...' : 'Lagre prompt'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Gemini-innstillinger</h2>
              <p className="text-slate-400 text-sm mt-1">
                Juster temperatur, topp‑P og oppløsning for Gemini 3 Pro.
              </p>
            </div>
          </div>
          {isGeminiConfigLoading ? (
            <p className="text-sm text-slate-400">Laster Gemini-innstillinger...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">
                    TEMPERATUR
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                    placeholder="Standard"
                    value={geminiConfig.temperature}
                    onChange={(e) =>
                      setGeminiConfig((prev) => ({ ...prev, temperature: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Tomt felt bruker modellens standardverdi.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">
                    TOP‑P
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                    placeholder="Standard"
                    value={geminiConfig.top_p}
                    onChange={(e) =>
                      setGeminiConfig((prev) => ({ ...prev, top_p: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">
                    MEDIA-RESOLUSJON
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                    value={geminiConfig.media_resolution}
                    onChange={(e) =>
                      setGeminiConfig((prev) => ({ ...prev, media_resolution: e.target.value }))
                    }
                  >
                    <option value="">Standard</option>
                    <option value="low">Lav</option>
                    <option value="medium">Medium</option>
                    <option value="high">Høy</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Gjelder analyse av bilder/PDF.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  onClick={handleGeminiConfigSave}
                  disabled={isGeminiConfigSaving || isGeminiConfigLoading}
                >
                  {isGeminiConfigSaving ? 'Lagrer...' : 'Lagre Gemini-innstillinger'}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div>
            <h2 className="text-xl font-semibold">Legg til eller oppdater nøkkel</h2>
            <p className="text-slate-400 text-sm mt-1">Gi nøkkelen et teknisk navn og en beskrivende etikett.</p>
          </div>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">NAVN*</label>
                <input
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                  placeholder="f.eks. gemini"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">ETIKETT</label>
                <input
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                  placeholder="API-nøkkel"
                  value={form.label}
                  onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 tracking-wide">VERDI*</label>
              <textarea
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-0"
                rows={3}
                placeholder="AIza..."
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                * Obligatoriske felt. Verdiene lagres lokalt i serverens filsystem.
              </p>
              <Button type="submit" disabled={saving} className="bg-indigo-600/90 hover:bg-indigo-500">
                {saving ? 'Lagrer...' : 'Lagre nøkkel'}
              </Button>
            </div>
          </form>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">Aktive nøkler</h2>
              <p className="text-slate-400 text-sm">Administrer hvilke API-nøkler som er tilgjengelige for backend.</p>
            </div>
            <span className="text-xs uppercase tracking-widest text-slate-500">
              {apiKeys.length} lagret
            </span>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Henter nøklene...</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-sm text-slate-400">Ingen nøkler er konfigurert ennå.</p>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div key={key.name} className="flex flex-col md:flex-row md:items-center justify-between bg-slate-950/40 border border-slate-800 rounded-2xl p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{key.label}</p>
                    <p className="text-xs text-slate-400">Navn: {key.name}</p>
                    <p className="text-xs text-slate-500">Oppdatert: {formatUpdated(key.updated_at)}</p>
                  </div>
                  <div className="mt-3 md:mt-0 flex items-center gap-3">
                    <span className="font-mono text-sm text-slate-200">{maskValue(key)}</span>
                    <Button variant="danger" className="text-xs" onClick={() => handleDelete(key.name)}>
                      Fjern
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [currentView, setCurrentView] = useState('generator');

  const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

  if (isAdminRoute) {
    return <AdminDashboard />;
  }

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900">
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-20">
        <div className="p-6 border-b border-gray-100 flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-gray-900">CleanSync</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <button
            onClick={() => setCurrentView('generator')}
            className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors ${currentView === 'generator' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <LayoutDashboard className="w-5 h-5 mr-3" />
            Plan Generator
          </button>
          <button
            onClick={() => setCurrentView('converter')}
            className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors ${currentView === 'converter' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <RefreshCw className="w-5 h-5 mr-3" />
            Plan Converter
          </button>
          <button
            onClick={() => setCurrentView('batch')}
            className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors ${currentView === 'batch' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <BoxSelect className="w-5 h-5 mr-3" />
            Batch Operations
          </button>
        </nav>
        <div className="p-4 border-t border-gray-100">
          <button className="flex items-center w-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">
            <Settings className="w-5 h-5 mr-3" />
            Settings
          </button>
          <div className="mt-4 flex items-center px-4">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
              JD
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-700">John Doe</p>
              <p className="text-xs text-gray-500">Admin</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 flex-shrink-0">
          <h1 className="text-lg font-semibold text-gray-800">
            {currentView === 'generator' && 'Ny renholdsplan'}
            {currentView === 'converter' && 'Konverter renholdsplan'}
            {currentView === 'batch' && 'Batch dashboard'}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium px-2 py-1 bg-green-100 text-green-700 rounded-full border border-green-200">
              System Operational
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          {currentView === 'generator' && <GeneratorView />}
          {currentView === 'converter' && <ConverterView />}
          {currentView === 'batch' && <BatchView />}
        </main>
      </div>
    </div>
  );
}

if (typeof document !== 'undefined') {
  const mountNode = document.getElementById('root');
  if (mountNode && !mountNode.dataset.cleansyncMounted) {
    mountNode.dataset.cleansyncMounted = 'true';
    const root = createRoot(mountNode);
    root.render(<App />);
  }
}
  const openHistoryDocx = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  };
