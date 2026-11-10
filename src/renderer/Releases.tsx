// 설정 창 「출시 현황」 탭: 앱마다 최신 판과 컴퓨터마다 깔린 판을 한 표로 본다. 업데이트를 놓친 컴퓨터가 주황 칸으로 드러난다.
// (결정 2026-11-10 「[MONITOR] 개발 - 출시 현황 자리」 추천안 1A 2A 3A)
import { useEffect, useState } from 'react'
import { locale, t } from './i18n'
import * as native from './native'
import type { ReleaseApp, ReleaseStatus } from '../preload/api'
import './Releases.css'

const REFRESH_MS = 30_000

/** 판 번호를 비교한다. 옛 모양 2.6.1030+2 는 앞부분만 본다. */
function older(installed: string, latest: string): boolean {
  const parts = (version: string) => version.split('+')[0].split('.').map(Number)
  const [a, b] = [parts(installed), parts(latest)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) < (b[i] ?? 0)
    }
  }
  return false
}

const stamp = new Intl.DateTimeFormat(locale, {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

function Build({ app }: { app: ReleaseApp }) {
  const { build } = app
  if (!build) {
    return (
      <td className="rel-mute rel-sub">
        {t(app.checked ? 'releases.buildNone' : 'releases.unknown')}
      </td>
    )
  }
  const label = {
    success: t('releases.buildSuccess'),
    failure: t('releases.buildFailure'),
    cancelled: t('releases.buildCancelled'),
    running: t('releases.buildRunning')
  }[build.result]
  const bad = build.result === 'failure' || build.result === 'cancelled'
  return (
    <td className={bad ? 'rel-warn rel-sub' : 'rel-sub'}>
      {label}
      <br />
      {stamp.format(build.at)}
    </td>
  )
}

function Cell({
  app,
  versions
}: {
  app: ReleaseApp
  versions: Record<string, string | null> | null
}) {
  if (!versions) {
    return <td className="rel-mute">{t('releases.unknown')}</td>
  }
  const installed = versions[app.name]
  if (!installed) {
    return <td className="rel-mute">{t('releases.none')}</td>
  }
  // Why: 최신 판을 모르면 깔린 판을 그대로 보여 준다. 「최신」이라고 단정하지 않는다.
  if (!app.latest) {
    return <td>{installed}</td>
  }
  return older(installed, app.latest) ? (
    <td className="rel-warn">{installed}</td>
  ) : (
    <td className="rel-mute">{t('releases.current')}</td>
  )
}

export default function Releases() {
  const [status, setStatus] = useState<ReleaseStatus | null>(null)
  useEffect(() => {
    const load = () => void native.releases().then(setStatus)
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  if (!status) {
    return <div className="rel" />
  }
  const { apps, computers } = status
  const behind = computers.reduce(
    (sum, { versions }) =>
      sum +
      apps.filter(
        (app) => app.latest && versions?.[app.name] && older(versions[app.name]!, app.latest)
      ).length,
    0
  )
  const staff = apps.some((app) => app.build !== undefined)
  // Why: GitHub 에서 못 읽은 앱이 있으면 뒤처졌는지 알 수 없다. 「모두 최신」이라고 단정하지 않는다.
  const headline = behind
    ? t('releases.behind', { count: behind })
    : t(apps.every((app) => app.checked) ? 'releases.allCurrent' : 'releases.unknown')
  return (
    <div className="rel">
      <div className="rel-head">
        <b>{headline}</b>
        <span>{t('releases.read', { count: computers.length })}</span>
      </div>
      <div className="s-card rel-card">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('releases.computer')}</th>
              {apps.map((app) => (
                <th scope="col" key={app.name}>
                  {app.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="rel-sum">
              <th scope="row">{t('releases.latest')}</th>
              {apps.map((app) => (
                <td key={app.name} className={app.latest ? '' : 'rel-mute'}>
                  {app.latest ?? t(app.checked ? 'releases.unreleased' : 'releases.unknown')}
                </td>
              ))}
            </tr>
            {staff && (
              <tr>
                <th scope="row" className="rel-mute">
                  {t('releases.build')}
                </th>
                {apps.map((app) => (
                  <Build key={app.name} app={app} />
                ))}
              </tr>
            )}
            {computers.map((computer, index) => (
              <tr key={`${computer.name}-${index}`}>
                <th scope="row">
                  {computer.self
                    ? t('releases.thisComputer', { name: computer.name })
                    : computer.name}
                </th>
                {apps.map((app) => (
                  <Cell key={app.name} app={app} versions={computer.versions} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rel-note">{t('releases.note')}</p>
    </div>
  )
}
