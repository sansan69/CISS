/**
 * Versioned enrollment notices. Keep the text in one place so the browser,
 * server audit record, and any future consent export use the same notice.
 * The Manglish copy is an aid for understanding; the English notice is the
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

export const ENROLLMENT_TERMS_MANGLISH = `
Njan ee jolikku vendiya eligibility requirements manassilaakki. Background,
character, document, training checks niyamaparamayi nadakkumennu enikk ariyaam.
Applicable labour, social-security, site-safety, confidentiality, client access
rules njan paalikkum.

Nalkiya security duty shraddhayode cheyyum; samayath report cheyyum; uniformum
ID cardum dharikkum; company/client property samrakshikkum; lawful instructions
paalikkum; confidential information purath parayilla. Duty-il urangukayilla,
lahari upayogichu report cheyyilla, anadhikritha force upayogikkilla, proper
relief illathe post vittupokilla. Required training complete cheyyum; incidents
udane report cheyyum.

Thettaya vivaram, forged documents, misconduct, allenkil duty breach undenkil
fair explanation chance nalkiyathinu shesham law anusarichu disciplinary action
undaakam. Proven loss, notice pay, company property recovery okke applicable law
anuvadikkunna paridhiyil mathram cheyyum. Wages, PF, ESI, overtime, leave,
final settlement enna statutory rights njan waive cheyyunnilla.

Njan nalkiya informationum documentsum ente arivil sathyavum shariyum aanu.
Lawful verification nadathunnathinu njan sammathikkunnu.
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

export const GUARD_UNDERTAKING_MANGLISH = `
Njan CISS Guard Undertaking vaayichu manassilaakki. Applicable law anusarichu
ithile commitments paalikkaan njan sammathikkunnu:

1. Signed undertaking-il paranja six-month minimum service period saadharanayayi
   complete cheyyum; applicable lawum lawful exceptionsum baadhakam aanu. Leave cheyyumbol
   employment terms-il paranja written notice nalkum; final settlement-il ninnulla
   lawful adjustment law anuvadikkunna paridhiyil mathram aayirikkum.
2. Njan nalkunna identity, address, PCC, qualification, mattu documents ellam
   genuine aanu; forged document undenkil law anusarichu action undaakam.
3. Lawful police, background, document verification nadathunnathinu sammathikkunnu.
4. Uniformum ID cardum dharikkum, samayath report cheyyum, duty-il alert aayirikkum;
   urangukayilla, lahari upayogikkilla, relief illathe post vittupokilla.
5. CISS, supervisor, client ennavarude lawful instructions paalikkum.
6. Confidential informationum company/client propertyum samrakshikkum; incidentum
   safety concernum udane report cheyyum.
7. Misconduct, poor duty, unauthorized absence, site violation ennivaykku fair
   explanation kazhinju law anusarichu disciplinary action undaakaam.
8. Ente fault/negligence/forgery/post abandonment kondu undaya proven loss mathram
   legal limitsum employment rulesum anusarichu recover cheyyum.
9. Employment theerumbol uniform, ID card, company property thirichu nalkum;
   nashtappetta propertykku law anusarichu recovery undaakaam.
10. Wages, PF, ESI, overtime, leave, final settlement, mattu statutory/contractual
    rights njan waive cheyyunnilla.
`.trim();
