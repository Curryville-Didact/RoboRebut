"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { twMerge } from "tailwind-merge";

const STARTER_SRC = "/brand/rebut-starter.png";
const PRO_SRC = "/brand/rebut-pro.png";

export type RebutBrandLogoProps = {
  variant: "starter" | "pro";
  className?: string;
};

/**
 * Plan logos from `public/brand/` — empty states and pricing cards only.
 * On load error, returns null so the layout still renders.
 */
export function RebutBrandLogo({ variant, className }: RebutBrandLogoProps) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const src = variant === "starter" ? STARTER_SRC : PRO_SRC;
  const alt = variant === "starter" ? "RoboRebut Starter" : "RoboRebut Pro";

  if (failed) return null;

  return (
    <div
      className={twMerge(
        "relative inline-flex h-14 w-14 shrink-0 items-center justify-center opacity-[0.92]",
        className
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="56px"
        className="object-contain object-center"
        onError={onError}
      />
    </div>
  );
}
