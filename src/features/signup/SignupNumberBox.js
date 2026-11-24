import React from 'react';
import { displayPhone } from '../onboarding/onboardingApi';
import { signupNumberState } from './signupNumberState';
import './SignupSenior.css';

export default function SignupNumberBox({ result, unavailable = false }) {
  const value = signupNumberState(result, { unavailable });
  return <section className={'signup-number-box is-' + value.state} aria-label="Forwarding number assignment" role="status" aria-live="polite" aria-atomic="true">
    <strong>{value.title}</strong>
    {value.number ? <span className="signup-number-box-value">{displayPhone(value.number)}</span> : null}
    <p>{value.detail}</p>
  </section>;
}
