import { SAMPLE_CONTENT_V04 } from './sample-v04'
import type { LearningContentBundle } from './types'

/**
 * 담당자 원본 이미지 2종('LS전선 Way', '경영철학') 및 CI 최종 승인본을 반영하기 위한 슬롯입니다.
 * 실제 원문 대조 승인 전까지 approved: false로 유지되어 실운영(production) 참가자 배정이 차단됩니다.
 */
export const APPROVED_CONTENT_TEMPLATE_V04: LearningContentBundle = {
  ...SAMPLE_CONTENT_V04,
  contentVersion: 'official-v0.4-pending',
  title: 'LS전선 Way 공식 콘텐츠 v0.4 (담당자 원문 대조·승인 대기)',
  approved: false,
  isSample: true,
  sampleNotice:
    '공식 원문 이미지 2종 및 CI 대조 승인이 완료되면 approved: true로 전환해 실참가자에게 배정합니다.',
}
