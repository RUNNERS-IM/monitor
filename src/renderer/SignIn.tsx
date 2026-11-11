// The shared RUNNERS sign-in sheet (runners-app-kit/desktop) wired to this app, for the Computers and Account tabs.
import { useCallback } from 'react'
import { locale } from './i18n'
import * as native from './native'
import { SignInSheet, type SignMode } from './runners-account/runners-account'

/** 메인이 돌려준 로그인 창 오류 코드를 로그인 창이 읽는 Error 로 다시 던진다. */
const rethrow = (problem: string | null) => {
  if (problem) {
    throw new Error(problem)
  }
}
const sendCode = async (purpose: 'signup' | 'reset', email: string) =>
  rethrow(await native.sendCode(purpose, email))

/** `onSignedIn` runs once the sheet has signed in (or set a new password and signed in with it). */
export function SignIn({ onSignedIn, onClose }: { onSignedIn: () => void; onClose: () => void }) {
  const signIn = useCallback(
    async (mode: SignMode, email: string, password: string, code?: string) => {
      rethrow(await native.signIn(mode, email, password, code))
      onSignedIn()
    },
    [onSignedIn]
  )
  const resetPassword = useCallback(
    async (email: string, code: string, password: string) => {
      rethrow(await native.resetPassword(email, code, password))
      onSignedIn()
    },
    [onSignedIn]
  )
  return (
    <SignInSheet
      lang={locale}
      signIn={signIn}
      sendCode={sendCode}
      resetPassword={resetPassword}
      onClose={onClose}
    />
  )
}
