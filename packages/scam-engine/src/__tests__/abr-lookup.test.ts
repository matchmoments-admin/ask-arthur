import { describe, expect, it } from "vitest";

import { extractEntityName, extractBusinessNames } from "../abr-lookup";

// Realistic ABR SearchByABNv202001 response fragments, built to the
// service WSDL (abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx?WSDL):
// a ResponseBusinessEntity carries EITHER <mainName><organisationName>
// (organisations) OR <legalName> with individual name parts, plus
// repeatable <businessName>/<mainTradingName>/<otherTradingName>.

const ORG_XML = `<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults xmlns="http://abr.business.gov.au/ABRXMLSearch/">
  <response>
    <businessEntity202001>
      <entityStatus><entityStatusCode>Active</entityStatusCode></entityStatus>
      <entityType><entityTypeCode>PUB</entityTypeCode><entityDescription>Australian Public Company</entityDescription></entityType>
      <mainName><organisationName>BUNNINGS GROUP LIMITED</organisationName><effectiveFrom>2000-01-01</effectiveFrom></mainName>
      <mainBusinessPhysicalAddress><stateCode>VIC</stateCode><postcode>3121</postcode></mainBusinessPhysicalAddress>
      <businessName><organisationName>BUNNINGS WAREHOUSE</organisationName><effectiveFrom>2001-01-01</effectiveFrom></businessName>
    </businessEntity202001>
  </response>
</ABRPayloadSearchResults>`;

const INDIVIDUAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults xmlns="http://abr.business.gov.au/ABRXMLSearch/">
  <response>
    <businessEntity202001>
      <entityStatus><entityStatusCode>Active</entityStatusCode></entityStatus>
      <entityType><entityTypeCode>IND</entityTypeCode><entityDescription>Individual/Sole Trader</entityDescription></entityType>
      <legalName><givenName>JANE</givenName><otherGivenName>MARY</otherGivenName><familyName>CITIZEN</familyName><effectiveFrom>2010-01-01</effectiveFrom></legalName>
      <mainTradingName><organisationName>JANE'S CRAFT STORE</organisationName><effectiveFrom>2010-01-01</effectiveFrom></mainTradingName>
      <otherTradingName><organisationName>CITIZEN HANDMADE</organisationName></otherTradingName>
    </businessEntity202001>
  </response>
</ABRPayloadSearchResults>`;

const INDIVIDUAL_FULLNAME_XML = `<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults xmlns="http://abr.business.gov.au/ABRXMLSearch/">
  <response>
    <businessEntity202001>
      <entityType><entityTypeCode>IND</entityTypeCode><entityDescription>Individual/Sole Trader</entityDescription></entityType>
      <legalName><fullName>JOHN QUINCY PUBLIC</fullName></legalName>
    </businessEntity202001>
  </response>
</ABRPayloadSearchResults>`;

const EXCEPTION_XML = `<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults xmlns="http://abr.business.gov.au/ABRXMLSearch/">
  <response>
    <exception><exceptionDescription>The GUID entered is not recognised as a Registered Party</exceptionDescription></exception>
  </response>
</ABRPayloadSearchResults>`;

describe("extractEntityName", () => {
  it("extracts an organisation name from <mainName>", () => {
    expect(extractEntityName(ORG_XML)).toBe("BUNNINGS GROUP LIMITED");
  });

  it("assembles an individual / sole-trader name from <legalName> parts", () => {
    // The dominant driver of false `unregistered` verdicts before #349 —
    // a sole trader has no <mainName>, only <legalName>.
    expect(extractEntityName(INDIVIDUAL_XML)).toBe("JANE MARY CITIZEN");
  });

  it("prefers <fullName> when the legal name carries one", () => {
    expect(extractEntityName(INDIVIDUAL_FULLNAME_XML)).toBe("JOHN QUINCY PUBLIC");
  });

  it("returns null for an exception response (no entity)", () => {
    expect(extractEntityName(EXCEPTION_XML)).toBeNull();
  });

  it("does not mistake a <businessName> organisationName for the entity name", () => {
    // Only <mainName>/<legalName> are the entity; a businessName is a
    // trading name, surfaced separately by extractBusinessNames.
    const xml = `<response><businessEntity202001>
      <businessName><organisationName>TRADING ALIAS</organisationName></businessName>
    </businessEntity202001></response>`;
    expect(extractEntityName(xml)).toBeNull();
  });
});

describe("extractBusinessNames", () => {
  it("collects registered business + trading names", () => {
    expect(extractBusinessNames(INDIVIDUAL_XML)).toEqual(
      expect.arrayContaining(["JANE'S CRAFT STORE", "CITIZEN HANDMADE"]),
    );
  });

  it("collects a <businessName> alongside an organisation's <mainName>", () => {
    expect(extractBusinessNames(ORG_XML)).toEqual(["BUNNINGS WAREHOUSE"]);
  });

  it("returns an empty array when no trading names are present", () => {
    expect(extractBusinessNames(EXCEPTION_XML)).toEqual([]);
  });
});
