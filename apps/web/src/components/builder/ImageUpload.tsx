'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui';

interface ImageUploadProps {
  onImageSelected: (base64: string) => void;
  onClear: () => void;
  className?: string;
}

export function ImageUpload({ onImageSelected, onClear, className }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be under 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setPreview(base64);
      // Strip data URL prefix for API
      const rawBase64 = base64.split(',')[1] ?? base64;
      onImageSelected(rawBase64);
    };
    reader.readAsDataURL(file);
  }, [onImageSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClear = () => {
    setPreview(null);
    onClear();
    if (inputRef.current) inputRef.current.value = '';
  };

  if (preview) {
    return (
      <div className={`relative inline-block ${className ?? ''}`}>
        <img src={preview} alt="Upload preview" className="h-16 w-16 rounded-lg object-cover border" />
        <button
          onClick={handleClear}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center text-xs hover:scale-110 transition-transform"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-dashed transition-colors ${
          isDragOver ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
        }`}
        title="Upload a screenshot to replicate"
      >
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Screenshot</span>
      </button>
    </div>
  );
}
