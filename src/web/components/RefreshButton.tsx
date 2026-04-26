import React from "react";

type RefreshButtonProps = {
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  disabled?: boolean;
  label?: string;
};

export default function RefreshButton({
  onRefresh,
  refreshing = false,
  disabled = false,
  label = "刷新",
}: RefreshButtonProps) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => void onRefresh()}
      disabled={disabled || refreshing}
      aria-busy={refreshing}
      title={label}
      style={{
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {refreshing ? (
        <span className="spinner spinner-sm" aria-hidden="true" />
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <path d="M21 12a9 9 0 0 1-15.2 6.5" />
          <path d="M3 12A9 9 0 0 1 18.2 5.5" />
          <path d="M3 4v6h6" />
          <path d="M21 20v-6h-6" />
        </svg>
      )}
      {refreshing ? "刷新中..." : label}
    </button>
  );
}
