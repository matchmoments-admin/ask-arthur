declare module "@svg-maps/australia" {
  interface Location {
    name: string;
    id: string;
    path: string;
  }

  interface SvgMap {
    label: string;
    viewBox: string;
    locations: Location[];
  }

  const map: SvgMap;
  export default map;
}
