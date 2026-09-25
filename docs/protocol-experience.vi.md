# Trải nghiệm SLP

Một repo, một protocol. Human giao outcome; Lead chọn cách làm. Bản sửa hiện
có local checks, chưa E2E live; package update không tự đổi protocol repo cũ.

## Setup một lần

Yêu cầu “Setup SLP cho repo này”. Agent đọc repo, đề xuất protocol đã điền theo
bằng chứng, hỏi phần thiếu về quyền/budget/delivery. Human xem file và diff trước
khi ghi. Giữ customization; chỉ custom hoàn toàn mới cần phỏng vấn sâu.

Kết quả: `.paseo-slp/workspace-protocol.md`, lựa chọn Peer pool và xác minh
Supervisor/Lead profiles. Không bắt chọn loại repo hay setup issue tracker.
Nguồn thực thi: [onboarding](../skills/paseo-slp-onboarding/SKILL.md) và
[template](../src/templates/workspace-protocol.md).

## Giao task

Human giao Lead trực tiếp hoặc qua Supervisor. Lead đánh giá outcome, scope,
risk và dependencies; hỏi khi thiếu quyết định hoặc vượt quyền.

| Outcome | Flow |
|---|---|
| Nhỏ, rõ, dễ đảo ngược, đủ điều kiện Tiny | Lean |
| Acceptance/contract còn mở hoặc nhiều phần phối hợp | Feature |
| Chuyển dữ liệu/trạng thái, rollout, recovery | Transition cho phase đó |
| Câu trả lời, nguyên nhân, lựa chọn phương án | Investigation |

Có thể kết hợp: feature pricing kèm backfill dùng Feature + Transition dưới
cùng Lead trong mandate. Đổi flow không cấp thêm quyền; tìm ra nguyên nhân không
cấp quyền sửa.

## Peer làm và review

Lean: Lead giao brief ngắn → một Engineer tự sửa/check/đọc lỗi/sửa lại → trả
candidate ổn định và proof, dừng ghi → Lead kiểm tra → Spec + Standards review
độc lập → findings về đúng owner, cùng seats re-review → Lead verdict/delivery.

“Một Peer/task” là một implementation owner, không phải một seat tổng cộng.
Feature có thể chia nhiều slice. Vòng engineering là hành vi agent dùng công cụ
runtime, không phải loop engine mới trong plugin.

Task A/C độc lập chạy song song với scope/worktree riêng; B phụ thuộc A chờ
A được chấp nhận và base chứa thay đổi cần thiết. Capacity tính cả reviewers.
Scope tăng thì Lead đánh giá lại; vượt mandate mới trả Supervisor/Human.

## Pull từ tracker nếu repo cần

Harness repo cung cấp Backlog MCP/GitHub tools, credentials, lịch wake/pull và
queue bookkeeping. Human giao Supervisor pull bằng công cụ có sẵn rồi giao
Lead. Lead vẫn đánh giá kỹ thuật và chọn flow; tracker không tạo Task Lead riêng.
Beads dùng nếu đã bật; không bật thì dùng nơi lưu trạng thái được giao.

Prompt/protocol không tự tạo khả năng chạy nền. Thiếu connector/wake path thì
báo gap; cấu hình và kiểm chứng tích hợp thuộc harness repo, không là bước
onboarding mặc định của plugin.

## Khi nào xong?

Lead trả candidate, checks thực chạy, hai kết quả review, verdict và rủi ro.
Actor có quyền giao artifact/report/PR hoặc evidence về tracker. Assignment
quy định điểm hoàn thành: PR mở khác PR merge; runbook ACCEPT khác migration đã
reconcile. Review pass không cấp quyền deploy. Human chỉ cần can thiệp vào quyết
định chưa rõ, quyền/budget và thay đổi mandate.

| Thành phần | Sở hữu |
|---|---|
| Global SLP policy/plugin | Authority, delegation, ownership, review invariants và runtime hiện có |
| Workspace protocol | Ceremony/flow và quyết định repo |
| Onboarding | Đề xuất, ghi protocol được xác nhận và lựa chọn runtime |
| Harness repo | External tools, automation, credentials và queue |
| Human assignment | Outcome, phạm vi, quyền và giới hạn task |
