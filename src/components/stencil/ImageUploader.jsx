import React, { useCallback, useRef } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ImageUploader({ onImageLoad }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => onImageLoad(img, e.target.result);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [onImageLoad]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full">
      
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300
          flex flex-col items-center justify-center gap-4 py-20 px-8
          ${isDragging ?
        'border-primary bg-primary/5 scale-[1.02]' :
        'border-border hover:border-primary/50 hover:bg-muted/50'}
        `
        }>
        
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Upload className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg text-foreground [font-family:'Urbanist',_sans-serif] font-bold">Drop your image here

          </p>
          <p className="text-sm text-muted-foreground mt-1">
            or click to browse · PNG, JPG, WEBP
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <ImageIcon className="w-3.5 h-3.5" />
          <span>High contrast images work best for stencils</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])} />
        
      </div>
    </motion.div>);

}