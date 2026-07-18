import { useEffect, useState } from "react";

interface ToastMessage {
  id: number;
  text: string;
}

let toastId = 0;
let addToast: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  addToast?.(msg);
}

export default function Toast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToast = (text: string) => {
      const id = ++toastId;
      setMessages((prev) => [...prev, { id, text }]);
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }, 2000);
    };
    return () => { addToast = null; };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {messages.map((m) => (
        <div
          key={m.id}
          className="animate-in slide-in-from-right rounded-lg bg-kumo-success px-4 py-2 text-sm text-white shadow-lg"
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}
