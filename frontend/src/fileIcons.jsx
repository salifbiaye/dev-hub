import { FILE_ICONS } from './fileIconData'
import { fileIconKeyFor } from './fileTypes'

/** The language / tool icon in front of a file name (React atom for .jsx, the
 *  red Java cup, JS, Python…), from the Material Icon Theme. Generic page otherwise. */
export function FileTypeIcon({ name, className }) {
  const icon = FILE_ICONS[fileIconKeyFor(name)] ?? FILE_ICONS.document
  return (
    <svg
      viewBox={icon.viewBox}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
