/**
 * Versioned enrollment notices. Keep the text in one place so the browser,
 * server audit record, and any future consent export use the same notice.
 * The English notices are the controlling text for the recorded acceptance.
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
