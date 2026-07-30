// Vite 의 `?url` 임포트만 선언한다. `vite/client` 전체를 참조하면 쓰지도 않는
// `import.meta.env` 등의 ambient 타입이 함께 들어오므로 필요한 것만 좁게 잡았다.
declare module "*?url" {
  const src: string;
  export default src;
}
