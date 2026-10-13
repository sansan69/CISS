/** API document references and form file controls use different names. */
const FORM_FIELD_ALIASES: Record<string, string> = {
  profilePictureUrl: "profilePicture",
  qualificationCertificateUrl: "qualificationCertificate",
  serviceBookDocumentUrl: "serviceBookDocument",
  armsLicenseDocumentUrl: "armsLicenseDocument",
  passportDocumentUrl: "passportDocument",
  aadharCardDocumentUrl: "aadharCardDocument",
  aadharCardDocumentBackUrl: "aadharCardDocumentBack",
  panCardDocumentUrl: "panCardDocument",
  bankPassbookStatementUrl: "bankPassbookStatement",
  policeClearanceCertificateUrl: "policeClearanceCertificate",
  termsAccepted: "termsAndConditions",
};

export function enrollmentErrorFormField(apiField: string): string {
  return FORM_FIELD_ALIASES[apiField] || apiField;
}
