import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers, Scissors } from 'lucide-react';
import ImageUploader from '@/components/stencil/ImageUploader';
import Logo from "@/assets/Logo.png";
import Heading from "@/assets/Heading.png"

export default function Home() {
  const navigate = useNavigate();

  const handleImageLoad = useCallback((img, dataUrl) => {
    // Store image in sessionStorage so StencilEditor can pick it up
    sessionStorage.setItem('sf_initial_image_url', dataUrl);
    navigate('/editor');
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center px-6 md:px-12 py-3 bg-black">
        <img
          src={Logo}
          alt="Stencil App"
          className="h-10 w-auto"
        />
      </nav>

      {/* Hero + Uploader */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-center max-w-2xl mx-auto w-full mt-8 md:mt-16">
          
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-xs font-heading font-medium mb-6 hidden">
            <Scissors className="w-3.5 h-3.5" />
            For Artists &amp; Makers
          </div>
          <img src={Heading}

          alt="Turn Images into Multi-Layer Stencils"
          className="w-full max-w-xl mx-auto" />
          
          <p className="text-muted-foreground font-body text-base md:text-lg mt-5 max-w-lg mx-auto leading-relaxed hidden">
            Upload any image and instantly generate layered stencils you can export as vectors,
            cut out, and paint with precision.
          </p>

          <div className="mt-10">
            <ImageUploader onImageLoad={handleImageLoad} />
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-6 border-t border-border">
        <p className="text-center text-xs text-muted-foreground font-body">
          
        </p>
      </footer>
    </div>);

}
