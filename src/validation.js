import { config } from './data.js'

export const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

const numberPattern = /^[A-Za-z0-9][A-Za-z0-9\-*]{4,29}$/

// 新建与编辑共用的统一校验；返回 { 字段: 错误信息 }，空对象表示通过
export function validateDocument(doc, documents = [], excludeId = null) {
  const errors = {}
  const value = (key) => String(doc?.[key] ?? '').trim()
  if (!value('name')) errors.name = '请填写证件名称'
  if (!value('holder')) errors.holder = '请填写持有人'
  const category = value('category')
  if (!category) errors.category = '请选择类别'
  else if (!config.categories.includes(category)) errors.category = `类别需从预设中选择：${config.categories.join('、')}`
  const number = value('number')
  if (!number) errors.number = '请填写证件号码'
  else if (!numberPattern.test(number)) errors.number = '证件号码需为 5-30 位字母或数字，可含 - 或 *'
  else if (!/\d/.test(number)) errors.number = '证件号码至少包含一位数字'
  else {
    const duplicate = documents.find((item) => item.id !== excludeId && String(item.number || '').trim().toLowerCase() === number.toLowerCase())
    if (duplicate) errors.number = `证件号码与「${duplicate.name}」重复`
  }
  const issued = value('issued')
  const expires = value('expires')
  if (!issued) errors.issued = '请选择签发日期'
  else if (!isValidDate(issued)) errors.issued = '签发日期格式不正确，应为 YYYY-MM-DD'
  if (!expires) errors.expires = '请选择有效期至'
  else if (!isValidDate(expires)) errors.expires = '有效期至格式不正确，应为 YYYY-MM-DD'
  if (!errors.issued && !errors.expires && issued > expires) errors.expires = '有效期至不能早于签发日期'
  return errors
}
