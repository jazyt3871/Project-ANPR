"use client";

import { Cctv, Eye, KeyRound, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * The first screen a new visitor sees. Sign in, register, or carry on as a
 * guest.
 *
 * "Continue as a guest" is a real, first-class choice rather than fine print:
 * the map is public information and a wall in front of it would be dishonest.
 * What the account buys is the ability to *add* to the map, so that is what the
 * copy promises.
 */
export function UnlockGate({
  onSignIn,
  onRegister,
  onGuest,
}: {
  onSignIn: () => void;
  onRegister: () => void;
  onGuest: () => void;
}) {
  return (
    // Below the Sheet's z-[1000], deliberately: the gate stays on screen behind
    // the sign-in sheet for context, but must not sit on top of it and swallow
    // the clicks meant for the form. Still above the header (500) and FAB (600).
    <div className="fixed inset-0 z-[900] grid place-items-center bg-void/92 px-6 backdrop-blur-md">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <Cctv className="size-6 shrink-0 text-sodium" strokeWidth={1.75} />
          <span
            className="readout text-[0.9375rem] font-semibold text-ink"
            style={{ letterSpacing: "0.2em" }}
          >
            PROJECT ANPR
          </span>
        </div>

        <h1 className="text-[1.375rem] leading-snug font-medium tracking-tight text-ink">
          A crowdsourced map of camera locations.
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-graphite">
          Every submission is three things measured from the street: a GPS fix,
          the bearing the lens looks along, and a photo.
        </p>

        <div className="mt-7 space-y-2.5">
          <Button size="lg" onClick={onRegister} className="w-full">
            <UserPlus className="size-4" />
            Create an account
          </Button>
          <Button size="lg" variant="ghost" onClick={onSignIn} className="w-full">
            <KeyRound className="size-4" />
            Sign in
          </Button>
          <Button size="lg" variant="quiet" onClick={onGuest} className="w-full">
            <Eye className="size-4" />
            Continue as a guest
          </Button>
        </div>

        <p className="mt-5 text-center text-[0.75rem] leading-relaxed text-graphite">
          Guests can browse every camera on the map. Adding one, or removing your
          own, needs an account.
        </p>
      </div>
    </div>
  );
}
