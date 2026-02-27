import { useState, useEffect, useCallback, useRef } from "react";
import { getAIConsent, setAIConsent } from "@/lib/storage";

interface UseAIConsentReturn {
  /** Whether the user has previously granted AI consent */
  hasConsent: boolean;
  /** Whether the consent modal should be displayed */
  showModal: boolean;
  /**
   * Ensure consent before proceeding.
   * Returns true if consent already granted, false if modal was shown.
   * When the modal is accepted, the stored `onAccept` callback fires.
   */
  ensureConsent: (onAccept: () => void) => boolean;
  /** Call when the user accepts the consent modal */
  acceptConsent: () => void;
  /** Call when the user dismisses the consent modal without accepting */
  dismissModal: () => void;
}

export function useAIConsent(): UseAIConsentReturn {
  const [hasConsent, setHasConsent] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pendingCallback = useRef<(() => void) | null>(null);

  useEffect(() => {
    getAIConsent().then((consented) => {
      setHasConsent(consented);
      setLoaded(true);
    });
  }, []);

  const ensureConsent = useCallback(
    (onAccept: () => void): boolean => {
      if (hasConsent) return true;
      pendingCallback.current = onAccept;
      setShowModal(true);
      return false;
    },
    [hasConsent]
  );

  const acceptConsent = useCallback(() => {
    setAIConsent(true);
    setHasConsent(true);
    setShowModal(false);
    if (pendingCallback.current) {
      pendingCallback.current();
      pendingCallback.current = null;
    }
  }, []);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    pendingCallback.current = null;
  }, []);

  return { hasConsent, showModal, ensureConsent, acceptConsent, dismissModal };
}
