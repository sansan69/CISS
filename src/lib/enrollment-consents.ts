/**
 * Versioned enrollment notices. Keep the text in one place so the browser,
 * server audit record, and any future consent export use the same notice.
 * The Malayalam copy is an aid for understanding; the English notice is the
 * controlling text for the recorded acceptance.
 */
export const ENROLLMENT_TERMS_VERSION = "enrollment-terms-v2" as const;

export const ENROLLMENT_TERMS_TEXT = `
I confirm that I meet the eligibility requirements communicated for this role and
understand that enrollment is subject to lawful background, character, document,
and training checks. I will comply with applicable labour, social-security,
site-safety, confidentiality, and client access requirements.

I will perform assigned security duties diligently, report on time in uniform
with my identity card, protect company and client property, follow lawful
instructions, maintain confidentiality, and never sleep on duty, report under
the influence of intoxicants, use unauthorized force, or abandon a post without
proper relief. I will complete required training and report incidents promptly.

I understand that inaccurate information, forged documents, misconduct, or a
breach of these duties may lead to lawful disciplinary action after a fair
opportunity to explain. Any recovery for proven loss, notice pay, or company
property will be made only to the extent permitted by applicable law and the
employment terms. My statutory rights, including wages, PF, ESI, overtime,
leave, and final settlement rights, are not waived.

I declare that the information and documents supplied by me are true and correct
to the best of my knowledge and I consent to lawful verification of them.
`.trim();

export const ENROLLMENT_TERMS_MALAYALAM = `
ഈ ജോലിക്ക് ആവശ്യമായ യോഗ്യതകൾ എനിക്ക് മനസ്സിലായി. പശ്ചാത്തലം, സ്വഭാവം,
രേഖകൾ, പരിശീലനം എന്നിവ സംബന്ധിച്ച പരിശോധനകൾ നിയമപ്രകാരം നടക്കുമെന്ന് എനിക്ക്
അറിയാം. ബാധകമായ തൊഴിൽ, സാമൂഹിക സുരക്ഷ, സൈറ്റ് സുരക്ഷ, രഹസ്യാത്മകത,
ക്ലയന്റ് പ്രവേശനം എന്നിവയുടെ നിയമങ്ങളും നിർദ്ദേശങ്ങളും ഞാൻ പാലിക്കും.

എനിക്ക് നൽകുന്ന സുരക്ഷാ ചുമതലകൾ ശ്രദ്ധയോടെ നിർവഹിക്കും; സമയത്ത് ഡ്യൂട്ടിക്ക്
റിപ്പോർട്ട് ചെയ്യും; യൂണിഫോമും ഐഡി കാർഡും ധരിക്കും; കമ്പനിയുടെയും ക്ലയന്റിന്റെയും
സ്വത്ത് സംരക്ഷിക്കും; നിയമാനുസൃത നിർദ്ദേശങ്ങൾ പാലിക്കും; രഹസ്യ വിവരങ്ങൾ പുറത്തു
പറയില്ല. ഡ്യൂട്ടിക്കിടെ ഉറങ്ങുകയോ ലഹരിയുടെ സ്വാധീനത്തിൽ റിപ്പോർട്ട് ചെയ്യുകയോ
അനധികൃതമായി ബലം പ്രയോഗിക്കുകയോ ശരിയായ പകരക്കാരനെ ഏൽപ്പിക്കാതെ പോസ്റ്റ്
വിട്ടുപോകുകയോ ചെയ്യില്ല. ആവശ്യമായ പരിശീലനം പൂർത്തിയാക്കുകയും സംഭവങ്ങൾ ഉടൻ
റിപ്പോർട്ട് ചെയ്യുകയും ചെയ്യും.

തെറ്റായ വിവരങ്ങൾ, വ്യാജ രേഖകൾ, മോശം പെരുമാറ്റം, അല്ലെങ്കിൽ ചുമതലകളുടെ ലംഘനം
ഉണ്ടായാൽ വിശദീകരിക്കാനുള്ള ന്യായമായ അവസരം നൽകിയ ശേഷം നിയമപ്രകാരം
അച്ചടക്ക നടപടി സ്വീകരിക്കാം. തെളിയിക്കപ്പെട്ട നഷ്ടം, നോട്ടീസ് ശമ്പളം,
കമ്പനി സ്വത്ത് എന്നിവ സംബന്ധിച്ച വീണ്ടെടുക്കൽ ബാധകമായ നിയമം അനുവദിക്കുന്ന
പരിധിയിൽ മാത്രം നടത്തും. ശമ്പളം, PF, ESI, ഓവർടൈം, അവധി, അന്തിമ തീർപ്പാക്കൽ
എന്നിവയുൾപ്പെടെയുള്ള നിയമപരമായ അവകാശങ്ങൾ ഞാൻ ഉപേക്ഷിക്കുന്നില്ല.

ഞാൻ നൽകിയ വിവരങ്ങളും രേഖകളും എന്റെ അറിവിൽ സത്യവും ശരിയുമാണെന്ന് പ്രഖ്യാപിക്കുന്നു.
നിയമാനുസൃത പരിശോധനകൾ നടത്തുന്നതിന് ഞാൻ സമ്മതിക്കുന്നു.
`.trim();

export const GUARD_UNDERTAKING_VERSION = "guard-undertaking-v1" as const;

export const GUARD_UNDERTAKING_TEXT = `
I have read and understood the CISS Guard Undertaking and agree to comply with
it subject to applicable law. I understand that the undertaking covers the
following commitments:

1. I will ordinarily complete the six-month minimum period stated in the signed
   undertaking, subject to applicable law and lawful exceptions. If I leave,
   I will give the written notice required by my employment terms; any lawful
   adjustment from final settlement will be limited to the amount permitted by law.
2. The identity, address, police-clearance, qualification, and other documents I
   submit are genuine and belong to me. Forgery may result in lawful action.
3. I consent to lawful police, background, and document verification.
4. I will wear the prescribed uniform and ID card, report on time, remain alert,
   not sleep or consume intoxicants on duty, and not abandon a post without relief.
5. I will follow lawful instructions from CISS, the supervisor, and the client.
6. I will protect confidential information and company/client property and report
   incidents or safety concerns promptly.
7. Misconduct, poor duty, unauthorized absence, or site violations may lead to
   lawful disciplinary action after an opportunity to explain.
8. Proven loss caused by my fault, negligence, forgery, or post abandonment may
   be recovered only within legal limits and applicable employment rules.
9. I will return uniform, ID card, and company property when requested or when
   employment ends; lawful recovery may apply for property actually lost.
10. This undertaking does not waive wages, PF, ESI, overtime, leave, final
    settlement, or any other statutory or contractual right.
`.trim();

export const GUARD_UNDERTAKING_MALAYALAM = `
ഞാൻ CISS Guard Undertaking വായിച്ച് മനസ്സിലാക്കി. ബാധകമായ നിയമങ്ങൾ അനുസരിച്ച്
ഇതിലെ ഉത്തരവാദിത്തങ്ങൾ പാലിക്കാൻ ഞാൻ സമ്മതിക്കുന്നു:

1. ഒപ്പിട്ട Undertaking-ൽ പറഞ്ഞിട്ടുള്ള ആറുമാസത്തെ കുറഞ്ഞ സേവനകാലം സാധാരണയായി
   പൂർത്തിയാക്കും; ബാധകമായ നിയമങ്ങളും നിയമാനുസൃത ഒഴിവുകളും ബാധകമായിരിക്കും.
   ജോലി വിടുമ്പോൾ തൊഴിൽ നിബന്ധനകളിൽ പറഞ്ഞിട്ടുള്ള എഴുത്തുപരമായ നോട്ടീസ് നൽകും;
   അന്തിമ തീർപ്പിൽ നിന്നുള്ള നിയമാനുസൃത കുറവ് നിയമം അനുവദിക്കുന്ന പരിധിയിൽ മാത്രം.
2. ഞാൻ നൽകുന്ന തിരിച്ചറിയൽ, വിലാസം, PCC, യോഗ്യത, മറ്റ് രേഖകൾ എല്ലാം യഥാർത്ഥമാണ്;
   വ്യാജ രേഖ നൽകിയാൽ നിയമപ്രകാരം നടപടി ഉണ്ടാകാം.
3. നിയമാനുസൃത പോലീസ്, പശ്ചാത്തല, രേഖാ പരിശോധനകൾ നടത്തുന്നതിന് ഞാൻ സമ്മതിക്കുന്നു.
4. യൂണിഫോമും ഐഡി കാർഡും ധരിക്കും, സമയത്ത് റിപ്പോർട്ട് ചെയ്യും, ഡ്യൂട്ടിയിൽ ജാഗ്രതയോടെ
   തുടരും; ഉറങ്ങുകയില്ല, ലഹരി ഉപയോഗിക്കുകയില്ല, പകരക്കാരനെ ഏൽപ്പിക്കാതെ പോസ്റ്റ് വിടുകയില്ല.
5. CISS, സൂപ്പർവൈസർ, ക്ലയന്റ് എന്നിവരുടെ നിയമാനുസൃത നിർദ്ദേശങ്ങൾ പാലിക്കും.
6. രഹസ്യ വിവരങ്ങളും കമ്പനിയുടെയും ക്ലയന്റിന്റെയും സ്വത്തും സംരക്ഷിക്കും; സംഭവങ്ങളും
   സുരക്ഷാ പ്രശ്നങ്ങളും ഉടൻ റിപ്പോർട്ട് ചെയ്യും.
7. മോശം പെരുമാറ്റം, മോശം ഡ്യൂട്ടി, അനുമതിയില്ലാതെ ഹാജരാകാതിരിക്കുക, സൈറ്റ് നിയമലംഘനം എന്നിവയ്ക്ക്
   വിശദീകരിക്കാനുള്ള ന്യായമായ അവസരം നൽകിയ ശേഷം നിയമപ്രകാരം അച്ചടക്ക നടപടി സ്വീകരിക്കാം.
8. എന്റെ തെറ്റ്, അശ്രദ്ധ, വ്യാജരേഖ, അല്ലെങ്കിൽ പോസ്റ്റ് ഉപേക്ഷിക്കൽ എന്നിവ മൂലമുണ്ടായ
   തെളിയിക്കപ്പെട്ട നഷ്ടം മാത്രം നിയമപരിധിയിലും തൊഴിൽ നിബന്ധനകളിലും അനുവദിക്കുന്ന വിധം വീണ്ടെടുക്കും.
9. ജോലി അവസാനിക്കുമ്പോൾ യൂണിഫോം, ഐഡി കാർഡ്, കമ്പനി സ്വത്ത് എന്നിവ തിരികെ നൽകും;
   യഥാർത്ഥത്തിൽ നഷ്ടപ്പെട്ട സ്വത്തിനായി നിയമപ്രകാരം വീണ്ടെടുക്കൽ ഉണ്ടാകാം.
10. ശമ്പളം, PF, ESI, ഓവർടൈം, അവധി, അന്തിമ തീർപ്പാക്കൽ, മറ്റ് നിയമപരവും കരാർപരവുമായ
    അവകാശങ്ങൾ ഞാൻ ഉപേക്ഷിക്കുന്നില്ല.
`.trim();
