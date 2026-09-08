# Paseo SLP

Bộ role Supervisor–Lead–Peer độc lập dành cho Paseo.

Cài một lần, chọn **SLP Supervisor** trong Paseo và giao mục tiêu. Role
instruction tự nạp; Supervisor tạo Lead, Lead giao Peer qua Paseo. Bạn có thể
nhắn tiếp trong session Supervisor đã có, không cần nhập lại prompt role.

Yêu cầu: Node >=22, Codex CLI đã đăng nhập, Paseo CLI/daemon đã có trên cùng máy.
Installer tích hợp vào Paseo hiện có; không tải hay thay phiên bản Paseo/Codex.

```bash
./install.sh
# hoặc: npm run install:slp
```

Lệnh này cài Markdown và CLI vào `~/.local/share/paseo-slp`, bổ sung ba
provider `slp-codex-{supervisor,lead,peer}` và ba profile **SLP …** vào
`$PASEO_HOME/config.json` (mặc định `~/.paseo`), bật MCP injection, rồi reload
cấu hình Paseo. Không tạo agent trong lúc cài. Không sửa AGENTS.md hay cấu hình
Codex toàn cục. Chọn model/mode/thinking/features tại **Settings → host → Agents → Agent profiles**.

Đổi nơi cài bằng `SLP_HOME=/absolute/path`; đổi host config bằng
`PASEO_HOME=/absolute/home`. Chạy installer trên máy của daemon. Cài lại cùng
candidate không ghi đè settings đã chỉnh. Candidate khác hoặc ID xung đột sẽ
được từ chối để giữ bản cài hiện tại.

Muốn xem các entry sẽ thêm trước khi ghi:

```bash
node bin/slp.mjs install /absolute/new/destination --paseo-home /absolute/paseo-home
# thêm --apply để ghi; thêm --reload để kích hoạt trên daemon đang chạy
```

Sau cài, mở workspace công việc trong Paseo, chọn **SLP Supervisor**, nhập
objective và phạm vi quyền bình thường, ví dụ: “Sửa lỗi hiển thị tổng giỏ hàng;
được sửa code/test trong repo này, không commit/push/deploy.” Supervisor và Lead
đã có procedure chọn profile con, giữ parentage và dùng finish notifications.
**SLP Lead** cũng dùng được nếu bạn muốn giao trực tiếp cho Lead.

Tùy chọn, tạo protocol riêng cho repo công việc một lần:

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" init /absolute/job-repo --apply
```

Lệnh chỉ tạo `WORKSPACE_PROTOCOL.md` khi chưa có; giữ nguyên file hiện hữu.
Lead đọc protocol và đưa constraint liên quan vào assignment cho Peer. Role
Markdown nằm trong bản cài; chiến thuật riêng của repo nằm trong protocol.

Gỡ sau khi các session dùng bản cài đã hoàn tất:

```bash
node bin/slp.mjs uninstall "$HOME/.local/share/paseo-slp" --apply --reload
```

Uninstall bỏ các entry do bản cài tạo và khôi phục hai cờ MCP trước cài; giữ các
config khác. Nếu profile/provider/file cài đã được sửa, lệnh dừng và giữ nguyên
để bạn quyết định cách giữ thay đổi. Protocol trong repo công việc được giữ lại.
Reload lỗi không đảo ngược việc ghi file: output báo `reloadRequired`/`reloadError`;
chạy lại `PASEO_HOME=/absolute/home paseo reload --json` sau khi xử lý nguyên nhân.
Installer không tự restart daemon hay trả lời permission của agent.

```bash
npm test
npm run check
```

Kiểm tra local gồm cài–gỡ, bảo toàn cấu hình, protocol và adapter stdio. Đã đối
chiếu với Paseo 0.7.2/Codex 0.153.4; chưa có E2E acceptance cho revision này.
Role là instruction hành vi, không phải filesystem/MCP sandbox. Candidate hiện
hỗ trợ Codex và một Peer writer; các provider khác và concurrent writers chưa
được kiểm chứng.

Đường offline vẫn có: `install <dir> --apply` không có `--paseo-home` chỉ stage
package; `prepare <request.json>` xuất create_agent arguments có role envelope.
Đường này không đăng ký profile hay tự tạo agent.

- [File map và contract](docs/contract.md)
- [Operating guide](docs/reference/agent-orchestration-complete-operating-guide.md)
- [Checklist nghiệm thu độc lập](docs/review-checklist.md)

Cơ chế host tham chiếu: [custom providers](https://paseo.sh/docs/custom-providers.md),
[agent profiles](https://paseo.sh/docs/agent-profiles.md),
[Codex app-server](https://learn.chatgpt.com/docs/app-server#threads).
