/// <reference types="vite/client" />

// oxlint-disable-next-line typescript/consistent-type-definitions -- vite 의 ImportMetaEnv 에 더하려면 interface 여야 한다
interface ImportMetaEnv {
  /** 빌드 때 넣는 Sentry 주소(GitHub 시크릿 SENTRY_DSN). 비면 오류를 보내지 않는다. */
  readonly VITE_SENTRY_DSN?: string
}
