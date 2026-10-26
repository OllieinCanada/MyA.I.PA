import React from "react";
import OnboardingWizard from "./features/onboarding/OnboardingWizard";
import { readWizardLocation, tokenFromSetupUrl } from "./features/onboarding/onboardingApi";

// The signed SMS/dashboard entry opens the same three approved pages.
// The URL is a read-only setup capability, not an owner-edit authorization.
export default function ForwardingSetup() {
  const location = readWizardLocation();
  return <OnboardingWizard token={tokenFromSetupUrl(window.location.href)} initialStep={location.step} initialEdit={location.edit} />;
}
