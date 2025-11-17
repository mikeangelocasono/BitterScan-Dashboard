"use client";

import { Toaster as ReactHotToaster } from "react-hot-toast";

export function Toaster() {
  return (
    <ReactHotToaster 
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#363636',
          color: '#fff',
        },
      }}
    />
  );
}

