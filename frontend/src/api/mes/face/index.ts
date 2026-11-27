import request from '@/config/axios'
import type { TokenType } from '@/api/login/types'

export const bindingLabels = {
  UNBOUND: '未绑定',
  ACTIVE: '已绑定',
  SELF_REVOKED: '本人已撤销',
  ADMIN_SUSPENDED: '管理员已停用',
  REENROLL_REQUIRED: '需要本人重录'
} as const

export interface BindingStatus {
  status: keyof typeof bindingLabels
  revision: number
}

export interface FaceStatus extends BindingStatus {
  ready: boolean
  enrolled: boolean
  cleanupPending: boolean
  comparison: string
  livenessSupported: boolean
  model: string
}

type PublicStatus = Pick<FaceStatus, 'ready' | 'comparison' | 'livenessSupported'>
export type FaceDecision = 'suspend' | 'require-reenroll'
const anonymous = { isToken: false, isVisitTenant: false }
export const FaceApi = {
  status: () => request.get<FaceStatus>({ url: '/mes/face/status' }),
  publicStatus: () =>
    request.get<PublicStatus>({ url: '/mes/face/login-status', headers: anonymous }),
  challenge: (username: string) =>
    request.post<{ challenge: string; expiresIn: number }>({
      url: '/mes/face/challenge',
      data: { username },
      headers: anonymous
    }),
  login: (username: string, challenge: string, imageBase64: string) =>
    request.post<TokenType>({
      url: '/mes/face/login',
      data: { username, challenge, imageBase64 },
      headers: anonymous
    }),
  enroll: (password: string, images: string[], expectedRevision: number, requestId: string) =>
    request.post({
      url: '/mes/face/enroll',
      data: { password, images, consent: true, expectedRevision, requestId }
    }),
  disable: (password: string, expectedRevision: number, requestId: string) =>
    request.post({ url: '/mes/face/disable', data: { password, expectedRevision, requestId } }),
  adminStatus: (ids: number[]) =>
    request.post<Record<number, BindingStatus>>({
      url: '/mes/face/admin/status-batch',
      data: { ids }
    }),
  decide: (
    user: number,
    action: FaceDecision,
    reason: string,
    expectedRevision: number,
    requestId: string
  ) =>
    request.post({
      url: `/mes/face/admin/users/${user}/${action}`,
      data: { reason, expectedRevision, requestId }
    })
}
