const BUSINESS_TARGETS = {
  ownerName: '#your-name-input', businessName: '#business-name-input', phone: '#business-phone-number-input',
  email: '#email-address-input', streetAddress: '#signup-business-details input[autocomplete="street-address"]',
  city: '#city-input', province: '#province-select', postalCode: '#postal-code-input',
};
function signupMissingRequirement({ currentStep, businessSlide, tradeSetupPanel, tradeMissing, propertyMissing, areaMissing, businessErrors = {}, pricing = {}, securityMissing }) {
  if (currentStep === 3) return securityMissing ? { selector: '#signup-human-verification', message: 'Complete the verification above to start your trial.' } : null;
  if (businessSlide === 1 && tradeSetupPanel === 'trade' && tradeMissing)
    return { selector: '.signup-trade-grid button', message: 'Choose one trade to continue.' };
  if (businessSlide === 1 && tradeSetupPanel === 'specialization' && propertyMissing)
    return { selector: '.signup-specialization-grid button', message: 'Choose at least one property type to continue.' };
  if (businessSlide === 2 && areaMissing)
    return { selector: '.signup-area-list button', message: 'Choose at least one service area to continue.' };
  if (businessSlide === 3) {
    const field = Object.keys(BUSINESS_TARGETS).find(key => businessErrors[key]);
    if (field) return { field, selector: BUSINESS_TARGETS[field], message: businessErrors[field] };
  }
  if (businessSlide === 4) {
    const validAmount = value => Number.isFinite(Number(value)) && Number(value) > 0;
    if (pricing.includeVisitFee && !validAmount(pricing.repairVisitFee)) return { pricing: true, selector: '#minimum-service-visit-fee-input', message: 'Enter a price greater than zero for the checked visit fee.' };
    if (pricing.includeHourlyRate && !validAmount(pricing.repairHourlyRate)) return { pricing: true, selector: '#hourly-labour-rate-input', message: 'Enter a price greater than zero for the checked hourly rate.' };
  }
  return null;
}
module.exports = { BUSINESS_TARGETS, signupMissingRequirement };
