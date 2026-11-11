// The lines of a RUNNERS menu-bar panel, the same in every desktop app that draws its menu-bar window in HTML (asked by
// [PROMPT] 개발, 2026-11-05: Monitor's panel as the shared source, with a bigger switch). The look is
// runners-menu.css; this file only puts the right classes together. It needs only React, and icons come in as
// elements so each app keeps its own icon package.
import type { ReactNode } from 'react'
import './runners-menu.css'

/** The first line: a bold name, a grey line after it, and an optional badge at the right. */
export function MenuHead(props: { name: ReactNode; sub?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="rm-head">
      <span className="rm-head-name">{props.name}</span>
      <span className="rm-head-sub">{props.sub}</span>
      {props.badge}
    </header>
  )
}

/** One line you press: icon, label, and what sits at the right edge (a value, a shortcut, a chevron). */
export function MenuItem(props: {
  icon?: ReactNode
  label: ReactNode
  trailing?: ReactNode
  onSelect: () => void
}) {
  return (
    <button type="button" className="rm-item" onClick={props.onSelect}>
      {props.icon}
      <span className="rm-label">{props.label}</span>
      {props.trailing && (
        <span className="rm-trailing">
          {/* Why: 아랍어 줄에서 ⇧⌘A 가 A⇧⌘ 로 뒤집히지 않게 글자 방향을 따로 잡는다. */}
          {typeof props.trailing === 'string' ? <bdi>{props.trailing}</bdi> : props.trailing}
        </span>
      )}
    </button>
  )
}

/** One on/off line: icon, label, and the switch at the right, like System Settings. */
export function MenuSwitch(props: {
  icon?: ReactNode
  label: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="rm-item rm-switch">
      {props.icon}
      <span className="rm-label">{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="rm-knob" aria-hidden />
    </label>
  )
}

/** The thin line between groups of lines. */
export function MenuSeparator() {
  return <div className="rm-separator" />
}
