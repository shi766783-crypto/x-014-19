// 统一的档案录入校验：新建、编辑共用同一套规则。
// - validateDocument：严格规则（新建时使用，错误一律拦截）
// - validateForSave：编辑时使用，旧档案原有、且用户未改动的问题降级为提示
// - describeLegacyIssues：供列表给历史数据打“待完善”标记，只提示、不拦截
import { config, today } from '../data'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^\d{17}[\dX]$/
// 护照 / 通行证 / 合同号等通用编号：5-30 位字母数字，允许 - / 分隔，且至少含一位数字
const GENERIC_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/-]{4,29}$/
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CODES = '10X98765432'

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (y < 1900 || y > 2100) return false
  const dt = new Date(`${value}T00:00:00`)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function normalizeNumber(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase()
}

const scalar = (value) => (value == null ? '' : String(value).trim())

function fieldLabel(key) {
  return config.form.fields.find(([k]) => k === key)?.[1] || key
}

// 18 位身份证：校验出生日期段与 GB 11643 校验位
function checkChineseId(num) {
  const year = Number(num.slice(6, 10))
  const month = Number(num.slice(10, 12))
  const day = Number(num.slice(12, 14))
  const birth = new Date(year, month - 1, day)
  if (year < 1900 || birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
    return 'idBirth'
  }
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(num[i]) * ID_WEIGHTS[i]
  return ID_CODES[sum % 11] === num[17] ? null : 'idChecksum'
}

/**
 * 严格校验一份档案。
 * @returns {{ errors: Record<string,string>, codes: Record<string,string>, warnings: Record<string,string> }}
 */
export function validateDocument(data, { documents = [], excludeId = null } = {}) {
  const errors = {}
  const codes = {}
  const warnings = {}
  const value = (key) => scalar(data[key])

  for (const key of config.form.required) {
    if (!value(key)) {
      errors[key] = `请填写${fieldLabel(key)}`
      codes[key] = 'required'
    }
  }

  if (value('category') && !config.categories.includes(value('category'))) {
    errors.category = '类别无效，请从下拉列表中选择'
    codes.category = 'category'
  }

  const number = value('number')
  if (number) {
    if (number.includes('*')) {
      errors.number = '号码为脱敏内容，请填写完整号码后再保存'
      codes.number = 'masked'
    } else if (ID_RE.test(normalizeNumber(number))) {
      const idError = checkChineseId(normalizeNumber(number))
      if (idError === 'idBirth') {
        errors.number = '身份证号码中的出生日期无效，请核对第 7-14 位'
        codes.number = 'idBirth'
      } else if (idError === 'idChecksum') {
        errors.number = '身份证号码校验位不正确，请核对最后一位'
        codes.number = 'idChecksum'
      }
    } else if (!/\d/.test(number) || !GENERIC_NUMBER_RE.test(number)) {
      errors.number = '号码格式不正确：应为 18 位身份证号，或 5-30 位字母、数字（可含 - / 分隔符）组成的编号'
      codes.number = 'format'
    }
  }

  const issued = value('issued')
  const expires = value('expires')
  if (issued && !isValidDate(issued)) {
    errors.issued = '签发日期格式无效，应为 YYYY-MM-DD'
    codes.issued = 'dateFormat'
  }
  if (expires && !isValidDate(expires)) {
    errors.expires = '有效期格式无效，应为 YYYY-MM-DD'
    codes.expires = 'dateFormat'
  }
  if (!errors.issued && !errors.expires && isValidDate(issued) && isValidDate(expires) && issued > expires) {
    errors.expires = '签发日期不能晚于有效期至日期，请检查日期先后'
    codes.expires = 'dateOrder'
  }

  if (number && !errors.number && value('holder')) {
    const normalized = normalizeNumber(number)
    const holder = value('holder')
    const duplicated = documents.some(
      (doc) => doc.id !== excludeId && scalar(doc.holder) === holder && normalizeNumber(doc.number) === normalized,
    )
    if (duplicated) {
      errors.number = `已存在持有人「${holder}」、号码相同的档案，请勿重复建档`
      codes.number = 'duplicate'
    }
  }

  if (isValidDate(issued) && issued > today) {
    warnings.issued = '签发日期晚于今天，请确认是否填写正确'
  }

  return { errors, codes, warnings }
}

// 跨字段规则涉及的字段：仅当整组字段都未改动时，才视为旧数据遗留问题
const ERROR_GROUPS = {
  dateOrder: ['issued', 'expires'],
  duplicate: ['holder', 'number'],
}

/**
 * 保存前校验（新建、编辑统一入口）。
 * 编辑旧档案时，档案原本就存在、且相关字段未被改动的错误降级为提示，
 * 保证历史档案随时能打开、能保存；用户新制造的问题仍然拦截。
 */
export function validateForSave(data, { original = null, documents = [] } = {}) {
  const strict = validateDocument(data, { documents, excludeId: original?.id ?? null })
  if (!original) return strict

  const errors = {}
  const warnings = { ...strict.warnings }
  for (const [field, message] of Object.entries(strict.errors)) {
    const group = ERROR_GROUPS[strict.codes[field]] || [field]
    const untouched = group.every((key) => scalar(data[key]) === scalar(original[key]))
    if (untouched) warnings[field] = message
    else errors[field] = message
  }
  return { errors, warnings, codes: strict.codes }
}

// 供列表页描述历史档案的问题（错误、提示合并为非阻断的提示项）
export function describeLegacyIssues(item, documents) {
  const { errors, warnings } = validateDocument(item, { documents, excludeId: item.id })
  return [...Object.entries(errors), ...Object.entries(warnings)].map(([field, message]) => ({ field, message }))
}
