"use client";
import { useEffect, useRef, useState } from 'react';
import { MAX_PHOTO_CAPTION_LENGTH } from '../../shared/dataset.ts';
import { CAPTION_PLACEHOLDER, CaptionGuide, PhotoSourcePicker } from './PhotoUploadControls';
const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[13px] font-mono text-white/85';
const hintCls = 'text-xs font-mono text-white/60';
const inputCls = 'w-full p-2 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus-visible:ring-2 focus-visible:ring-emerald-400';
export interface PhotoGroup {
  files: File[];
  captions: string[];
}


const photoRemoveCls =
  // 32px: tombol hapus menempel di sudut pratinjau — 44px akan menutupi thumbnail
  // tetangga; 32px masih memenuhi WCAG 2.5.8 (target minimal 24px).
  'absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500/90 text-white text-[12px] font-bold leading-none flex items-center justify-center hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200';

/**
 * Pemilih foto wizard (butir 2): mengelola pratinjaunya sendiri lalu melapor
 * berkas + caption ke induk lewat onChange. Aturan file mengikuti foto batch:
 * JPG/PNG sampai 5 MB, tiap foto wajib ber-caption.
 */
export default function PhotosBlock({
  prefix,
  title,
  hint,
  error,
  onChange,
}: {
  prefix: string;
  title: string;
  hint: string;
  error?: string;
  onChange: (photos: PhotoGroup) => void;
}) {
  const previewRef = useRef<string[]>([]);
  useEffect(() => () => previewRef.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [captions, setCaptions] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const select = (list: FileList | null, input: HTMLInputElement) => {
    const incoming = Array.from(list ?? []);
    const usable = incoming.filter((f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0);
    const fitting = usable.filter((f) => f.size <= 5 * 1024 * 1024);
    if (usable.length < incoming.length) {
      setNote('Hanya file JPG/PNG yang dipakai. File lain dilewati.');
    } else if (fitting.length < usable.length) {
      setNote('Tiap foto maksimal 5 MB. File lebih besar dilewati.');
    } else {
      setNote('');
    }
    const nextFiles = [...files, ...fitting];
    const nextCaptions = [...captions, ...fitting.map(() => '')];
    setFiles(nextFiles);
    const added = fitting.map((f) => URL.createObjectURL(f));
    previewRef.current.push(...added);
    setPreviews((prev) => [...prev, ...added]);
    setCaptions(nextCaptions);
    onChange({ files: nextFiles, captions: nextCaptions });
    input.value = '';
  };

  const remove = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    const nextFiles = files.filter((_, i) => i !== index);
    const nextCaptions = captions.filter((_, i) => i !== index);
    setPreviews(previews.filter((_, i) => i !== index));
    setFiles(nextFiles);
    setCaptions(nextCaptions);
    onChange({ files: nextFiles, captions: nextCaptions });
  };

  const setCaption = (index: number, value: string) => {
    const next = captions.map((c, j) => (j === index ? value : c));
    setCaptions(next);
    onChange({ files, captions: next });
  };

  return (
    <fieldset className={fieldCls}>
      <legend className={labelCls}>{title}</legend>
      <PhotoSourcePicker id={`${prefix}-photos`} onFiles={select} />
      <p className={hintCls}>{hint}</p>
      {note && !error ? (
        <p className="text-[11px] font-mono text-amber-300" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] font-mono text-amber-300" role="status">
          {error}
        </p>
      ) : null}
      {previews.length > 0 && (
        <>
          <CaptionGuide />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {previews.map((src, i) => (
              <div key={src} className="relative space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Pratinjau foto ${i + 1}`} className="w-full h-16 object-cover rounded-lg border border-white/10" />
                <label className={`${labelCls} flex items-center gap-1`} htmlFor={`${prefix}-photo-caption-${i}`}>
                  Caption <span aria-hidden="true" className="text-rose-400">*</span>
                </label>
                <input
                  id={`${prefix}-photo-caption-${i}`}
                  name={`${prefix}-photo-caption-${i}`}
                  type="text"
                  maxLength={MAX_PHOTO_CAPTION_LENGTH}
                  autoComplete="off"
                  value={captions[i] ?? ''}
                  aria-required="true"
                  onChange={(e) => setCaption(i, e.target.value)}
                  placeholder={CAPTION_PLACEHOLDER}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Hapus foto ${i + 1}`}
                  className={photoRemoveCls}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}

