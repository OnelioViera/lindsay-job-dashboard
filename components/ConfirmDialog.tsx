"use client";

export type ConfirmReq = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

/** In-page confirmation, styled like the Structure Tracker's delete box (replaces the browser popup). */
export default function ConfirmDialog({
  req,
  onClose,
}: {
  req: ConfirmReq | null;
  onClose: () => void;
}) {
  if (!req) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-brand-red">{req.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{req.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => {
              req.onConfirm();
              onClose();
            }}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark"
          >
            {req.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
