import { ArrowRight, Download, Plus, Trash2 } from '../../../../components/ui/icons'
import Button from '../../../../components/ui/Button'
import Icon from '../../../../components/ui/Icon'
import { HeaderIconButton } from '../../../../components/ui/HeaderIconButton'
import { Block, Matrix, Section, Specimen, SpecimenGrid } from '../auditKit.jsx'
import { ForceFocus, ForceHover } from '../forcedStates.jsx'

/**
 * Section 2 — buttons.
 *
 * Every variant × every size × every state, from the real primitive. The
 * variant and size lists are the primitive's own, so a new variant added to
 * Button.jsx without a row here is a visible hole rather than a silent one.
 *
 * THE HOVER COLUMN IS THE POINT OF THE MATRIX.
 * You cannot hover four buttons at once, and a hover state that inverts badly
 * in one theme is exactly the kind of thing a theme pass misses. `ForceHover`
 * lifts Button's OWN `hover:` utilities off the rendered element and
 * re-applies them unprefixed, so the specimen cannot show a hover the app does
 * not produce — see forcedStates.js.
 */

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger']
const SIZES = ['sm', 'md', 'lg']

export default function ButtonsSection() {
  const stateColumns = [
    'default',
    'hover (forced)',
    'focus-visible (forced)',
    'disabled',
    'loading',
    'leading icon',
    'trailing icon',
    'fullWidth',
  ]

  const stateRows = VARIANTS.map((variant) => ({
    label: variant,
    cells: [
      <Button key="d" variant={variant}>Save paper</Button>,
      <ForceHover key="h">
        <Button variant={variant}>Save paper</Button>
      </ForceHover>,
      <ForceFocus key="f">
        <Button variant={variant}>Save paper</Button>
      </ForceFocus>,
      <Button key="x" variant={variant} disabled>
        Save paper
      </Button>,
      <Button key="l" variant={variant} loading>
        Save paper
      </Button>,
      <Button key="li" variant={variant} leadingIcon={<Icon as={Plus} size="sm" />}>
        New
      </Button>,
      <Button
        key="ti"
        variant={variant}
        trailingIcon={<Icon as={ArrowRight} size="sm" />}
      >
        Continue
      </Button>,
      <div key="fw" className="w-40">
        <Button variant={variant} fullWidth>
          Full width
        </Button>
      </div>,
    ],
  }))

  const sizeRows = VARIANTS.map((variant) => ({
    label: variant,
    cells: SIZES.map((size) => (
      <Button key={size} variant={variant} size={size}>
        Generate
      </Button>
    )),
  }))

  return (
    <Section
      id="buttons"
      title="2 · Buttons"
      note={
        'Rendered from src/components/ui/Button.jsx. The hover and focus columns are forced — they repeat the primitive\'s own hover/focus declarations so all four can be judged at once; if Button\'s hover rules change, those two columns are the first thing to re-check.'
      }
    >
      <Block title="Variant × state">
        <Matrix columns={stateColumns} rows={stateRows} />
      </Block>

      <Block title="Variant × size">
        <Matrix columns={SIZES} rows={sizeRows} />
      </Block>

      <Block
        title="Rendered as a link"
        note="Button accepts `as` — an anchor gets aria-disabled instead of the disabled attribute, so the disabled look must still read as unavailable."
      >
        <SpecimenGrid min="13rem">
          <Specimen label='as="a" variant="primary"'>
            <Button as="a" href="#buttons" variant="primary">
              Anchor button
            </Button>
          </Specimen>
          <Specimen label='as="a" disabled'>
            <Button as="a" href="#buttons" variant="secondary" disabled>
              Anchor disabled
            </Button>
          </Specimen>
        </SpecimenGrid>
      </Block>

      <Block
        title="HeaderIconButton"
        note="The icon-only control used in page chrome, in all three of its tones. `active` and `important` are painted with fixed Tailwind literals (blue-50/amber-50) rather than tokens — compare them against the default tone in Night."
      >
        <div className="flex flex-wrap items-end gap-4">
          <HeaderIconButton label="Download" icon={Download} onClick={() => {}} />
          <HeaderIconButton label="Delete" icon={Trash2} onClick={() => {}} />
          <HeaderIconButton label="Active" icon={Plus} active onClick={() => {}} />
          <HeaderIconButton label="Important" icon={Plus} important onClick={() => {}} />
          <HeaderIconButton label="Badge" icon={Download} badge={3} onClick={() => {}} />
          <Button variant="secondary" size="sm">
            for height comparison
          </Button>
        </div>
      </Block>
    </Section>
  )
}
