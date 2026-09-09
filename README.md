# Paseo SLP

Bộ role Supervisor–Lead–Peer độc lập dành cho Paseo.

Cài một lần, chọn **SLP Supervisor** trong Paseo và giao mục tiêu. Role
instruction tự nạp; Supervisor quan sát Lead hiện có hoặc tạo Lead theo assignment,
Lead giao Peer qua Paseo. Bạn có thể
nhắn tiếp trong session Supervisor đã có, không cần nhập lại prompt role.

Yêu cầu: Node >=22, Paseo CLI/daemon và Codex/Pi CLI tương ứng với provider bạn
muốn dùng, cùng credentials của provider đó trên máy daemon. Pi cần hỗ trợ
`--append-system-prompt` lặp lại (bản Pi hiện được kiểm tra có hỗ trợ).
Installer tích hợp vào Paseo hiện có; không tải hay thay phiên bản Paseo/Codex.

```bash
./install.sh
# hoặc: npm run install:slp
```

Lệnh này cài Markdown và CLI vào `~/.local/share/paseo-slp`, bổ sung sáu
provider `slp-codex-{supervisor,lead,peer}` và `slp-pi-{supervisor,lead,peer}`, cùng ba profile vào
`$PASEO_HOME/config.json` (mặc định `~/.paseo`), bật MCP injection, rồi reload
cấu hình Paseo. Không tạo agent trong lúc cài. Không sửa AGENTS.md hay cấu hình
Codex toàn cục. Ba profile Supervisor/Lead/Peer có mặc định tại **Settings → host → Agents → Agent profiles**.
Routing thuộc từng repo: Human chỉnh `.paseo-slp/slp-routing.json` cạnh
`.paseo-slp/WORKSPACE_PROTOCOL.md`
để Lead chọn provider/model/thinking theo từng công việc. Installer host không tạo
bảng routing global; khởi tạo repo theo hướng dẫn dưới đây.

Đổi nơi cài bằng `SLP_HOME=/absolute/path`; đổi host config bằng
`PASEO_HOME=/absolute/home`. Chạy installer trên máy của daemon. Cài lại cùng
candidate không ghi đè settings đã chỉnh. Candidate khác hoặc ID xung đột sẽ
được từ chối để giữ bản cài hiện tại. Để nâng cấp bản đã cài, dùng cutover sang thư
mục mới; lệnh giữ settings của profile và giữ nguyên file cũ cho session đang dùng:

```bash
node bin/slp.mjs upgrade "$HOME/.local/share/paseo-slp.next" \
  --from "$HOME/.local/share/paseo-slp" --apply --reload
```

Bỏ `--apply --reload` để xem trước. Các session cũ vẫn dùng provider process cũ;
profile mới áp dụng cho launch sau. Nếu bản trước có bốn profile disposition do
SLP tạo, upgrade giữ settings của chúng trong `paseo-binding.json` → `retiredProfiles`,
rồi gỡ bốn profile.
Catalog đã có và profile cá nhân không thuộc bản cài được giữ.
Bản cũ được giữ để bạn quản
lý sau khi các session phụ thuộc đã kết thúc; không dùng uninstall bản cũ để gỡ
các entry đã chuyển sang bản mới. `.next` chỉ là đường dẫn cutover tạm. Sau khi
settle các session cũ, đưa candidate đã xác minh trở lại đường dẫn chuẩn
`~/.local/share/paseo-slp`, reload, rồi xóa thư mục tạm. Dùng đường dẫn đang được
provider tham chiếu cho `init` và `prepare`.

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

Để đặt model và reasoning riêng cho từng role:

1. Mở **Settings → host chạy công việc → Agents → Agent profiles**.
2. Sửa **SLP Supervisor**, **SLP Lead** hoặc **SLP Peer**.
3. Chọn provider `slp-codex-{role}` hoặc `slp-pi-{role}` tương ứng, rồi chọn
   **Model**, **Thinking**, **Mode** nếu provider có và features rồi **Save**.
4. Khi tạo session trực tiếp, chọn profile đã lưu trong model picker. Khi Lead tự
   spawn Peer, Lead chọn một cấu hình đầy đủ từ bảng routing bên dưới; cấu hình đó
   thay thế mặc định runtime của profile, không kế thừa settings của Lead.

**Thinking** là reasoning effort; **Mode** là quyền/approval, hai thiết lập khác
nhau. Chọn giá trị do provider/model thực tế cung cấp. Agent dùng `list_profiles`,
`list_models`, `inspect_provider` để discover; trường profile `thinkingOptionId`
được truyền thành `settings.thinkingOptionId` khi tạo agent.

Sửa profile ảnh hưởng lần chọn/launch sau, không cập nhật session đã chạy. Với
session hiện hữu, Paseo có `update_agent` để đổi model/thinking trong provider đó
nếu provider hỗ trợ. Profile vẫn giữ mặc định riêng cho các session tương lai.
Xem [Agent profiles của Paseo](https://paseo.sh/docs/agent-profiles.md).

Khởi tạo repo công việc một lần:

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" init /absolute/job-repo --apply
```

Lệnh chỉ tạo hai file cấu hình còn thiếu và giữ nguyên từng file đã có:

- `.paseo-slp/WORKSPACE_PROTOCOL.md`: quy trình, mức rủi ro, proof gate, budget và quyền fallback.
- `.paseo-slp/slp-routing.json`: lựa chọn provider/model/reasoning, ưu tiên và trạng thái quota của repo.

Skill onboarding được cài riêng để agent có thể auto-trigger. Từ repo muốn dùng,
cài project-local (tạo `.agents/skills/paseo-slp-onboarding` và có thể commit cùng repo):

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --agent codex --copy --yes
```

Hoặc cài global cho mọi repo của user:

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --agent codex --global --copy --yes
```

Sau khi package được publish lên GitHub, thay đường dẫn local bằng URL/repository
đã publish, ví dụ `https://github.com/<owner>/<repo>`. Dùng project mode hoặc thêm
`--global` như trên. Với lệnh này, project skill nằm ở `.agents/skills`, global skill
nằm ở `~/.agents/skills`; Codex và Pi đều discover hai scope đó. Kiểm tra bằng
`npx skills@latest list --agent codex` hoặc thêm `--global` cho user scope. Mở session
mới sau khi cài, rồi yêu cầu onboard/setup SLP cho repo; description của skill sẽ
trigger workflow.
Xem [skill nguồn](skills/paseo-slp-onboarding/SKILL.md).

Hai file tách riêng: protocol là hướng dẫn vận hành, JSON là dữ liệu có thể kiểm
tra tự động và đổi thường xuyên. Cả hai thuộc repo và có thể version cùng code;
không nhúng JSON vào Markdown. Lead đọc chúng, rồi truyền constraint liên quan vào
assignment cho Peer. Worktree mới cần các file trong base candidate hoặc bản copy
được cho phép; mỗi worktree đọc cấu hình của chính nó.

Nếu đã có bảng global từ bản trước, import một lần vào repo muốn dùng:

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" init /absolute/job-repo \
  --routing-from /absolute/previous/slp-routing.json --apply
```

Import chỉ tạo catalog khi chưa có; không ghi đè, trộn ngầm hay tiếp tục liên kết
với file nguồn. Sau đó Human chỉnh bản trong repo. Thiếu catalog không fallback global.

Protocol chọn topology và proof gate theo risk: task nhỏ có thể dùng một Engineer;
việc nhạy về architecture/lifecycle có Architect, independent Reviewer hoặc nhiều
lane. Một profile Peer nhận disposition qua assignment. Lead giữ integration và
technical acceptance; Supervisor giữ quan sát và relay quyết định của Human.

Supervisor/Lead dùng event trước, heartbeat làm safety net khi task cần và có
authority; cadence và điều kiện dừng thuộc protocol/assignment. Reference được cài
kèm hướng dẫn tạo/xóa heartbeat của đúng session, ghi causal notebook, recovery và
20 anti-pattern từ guide. Role chỉ dẫn đọc reference theo tình huống; Peer nhận các
constraint liên quan qua assignment. Đây là policy cho agent sử dụng primitive Paseo,
không có detector hay monitoring daemon riêng trong package.

**Bảng model cho Lead:** Human chỉnh `<repo>/.paseo-slp/slp-routing.json`, cạnh
`.paseo-slp/WORKSPACE_PROTOCOL.md`. Mỗi repo có lựa chọn riêng; chỉnh không cần cài lại hay
reload Paseo. Xem [config mẫu](examples/slp-routing.json) với các lựa chọn từ yêu cầu
Luna/GLM của bạn; đây là gợi ý cấu hình do Human đánh giá, không phải bảng benchmark:

| Option | Provider | Model | Thinking |
|---|---|---|---|
| luna-code | `codex` | `gpt-5.6-luna` | `medium` |
| luna-reason | `codex` | `gpt-5.6-luna` | `high` |
| glm-design | `pi` | `opencode/glm-5.3-flash` | `medium` |

Mỗi option gồm `id`, `provider`, `roles`, `model`, `thinkingOptionId`, `enabled`,
`availability`, `priority`, `suitableFor`, `avoidFor`, `notes`; `modeId` và `features`
là tùy chọn. `provider` chọn `codex` hoặc `pi`; loader chọn wrapper đúng role.
`suitableFor`/`avoidFor` là tag tự do và `notes` giải thích điểm mạnh, hạn chế,
chi phí hoặc tình hình quota. Human có thể thêm nhiều option cùng model nhưng
reasoning khác nhau. `roles` giới hạn role được dùng; số `priority` cao hơn được
ưu tiên khi các lựa chọn phù hợp ngang nhau.

Lead đọc bảng trước mỗi spawn, tự chọn disposition và option theo công việc cùng
budget trong assignment/protocol. Engineer, Architect, Reviewer, Scout chỉ là
disposition trong prompt; hai Engineer có thể dùng hai option khác provider/model.
Những tag này không tự tạo hay ánh xạ sang profile.

Khi hết quota, Human đặt `availability: "quota-exhausted"` hoặc `enabled: false`
cho các option bị ảnh hưởng. Bật lựa chọn khác bằng `enabled: true` và
`availability: "ready"`; `paused`/`unknown` cũng không được chọn. Config mẫu để
`unknown` cho đến khi Human xác nhận. Với quota chung của Codex, cập nhật mọi option
Codex liên quan; các endpoint Pi có thể có quota riêng. `policy` ghi quyền fallback
và budget; được chọn một option không mở rộng quyền sửa code hay chi tiêu.
Lead vẫn kiểm tra provider/model/effort thực tế trước khi tạo agent.

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" routes /absolute/job-repo
```

Lệnh trả bảng của repo được chỉ định và `sha256`. `prepare` đọc theo trường
`repository` trong request; không phụ thuộc cwd, `PASEO_HOME` hoặc bảng repo khác.
Catalog mới rỗng cần Human điền lựa chọn
hoặc chỉ định settings cho lần launch cụ thể.

**Đổi Lead sang Pi khi Codex hết quota:** đổi provider của **SLP Lead** thành
`slp-pi-lead`, chọn model/thinking tương ứng và Save cho các launch sau. Để chuyển
công việc đang chạy, nhắn Supervisor: “Codex hết quota, chuyển Lead này sang Pi,
dùng model …, giữ scope hiện tại và handoff công việc.” Có thể chỉ định target
cho riêng lần handoff mà không đổi profile mặc định. Supervisor kiểm tra Lead cũ
đã ngừng điều phối, thu state/evidence và tạo Lead mới với cùng policy trên Pi.
Nếu Lead cũ không trả lời được, Supervisor lấy state từ timeline/artifact; không
cần gọi lại model hết quota chỉ để xin summary. Khi không có Supervisor, Human
chuyển handoff sang session Lead mới và xác nhận ownership.

Đây là handoff sang session mới: host không đổi provider tại chỗ và không tự chuyển
parentage của Peer. Procedure giữ Peer IDs/ownership, xử lý quyền truy cập descendants
và wake sources; Lead mới nhận việc sau khi kiểm tra trạng thái bàn giao. Nếu muốn
tự động chọn provider dự phòng, ghi trước fallback và budget/authority trong protocol;
chỉ lỗi quota không tự cấp quyền đổi provider. Đổi model/thinking trong cùng provider
có thể dùng `update_agent`, tùy capability của provider.

Đường offline: `prepare` nhận `role`, `disposition`, inventory `providers` và
`route: { "optionId": "glm-design", "catalogSha256": "<sha256 từ routes>" }`;
`repository` phải là repo chứa catalog. Lệnh đọc lại file đó, chặn hash
cũ/option tắt/hết quota/sai role và không mang theo settings của profile. Lead tự
chọn option; helper không tự xếp hạng model. Xem [ví dụ mixed Peer](examples/mixed-peer.request.json).
Các launch được Human chỉ định trực tiếp vẫn nhận `binding` hoặc `profiles/providers/route`;
`route.profileId` độc lập với disposition. Model Pi chứa `/` được giữ nguyên.
`prepare-handoff <request.json>` thêm snapshot và handoff vào create_agent arguments;
xem [ví dụ handoff](examples/provider-handoff.request.json). Hai lệnh chỉ chuẩn bị
arguments; Supervisor/Lead dùng Paseo để thực sự tạo agent.

Gỡ sau khi các session dùng bản cài đã hoàn tất:

```bash
node bin/slp.mjs uninstall "$HOME/.local/share/paseo-slp" --apply --reload
```

Uninstall bỏ các entry do bản cài tạo và khôi phục hai cờ MCP trước cài; giữ các
config khác và giữ catalog Human. Nếu profile/provider/file cài đã được sửa, lệnh dừng và giữ nguyên
để bạn quyết định cách giữ thay đổi. Protocol trong repo công việc được giữ lại.
Reload lỗi không đảo ngược việc ghi file: output báo `reloadRequired`/`reloadError`;
chạy lại `PASEO_HOME=/absolute/home paseo reload --json` sau khi xử lý nguyên nhân.
Installer không tự restart daemon hay trả lời permission của agent.

```bash
npm test
npm run check
```

Kiểm tra local gồm cài–gỡ, bảo toàn cấu hình, protocol và adapter stdio; chúng không
chứng minh role tuân thủ operating guide. Transport trước đây được đối chiếu với
Paseo 0.7.2/Codex 0.153.4; chưa có E2E acceptance cho revision này. Role là instruction
hành vi, không phải filesystem/MCP sandbox. Transport hỗ trợ Codex và Pi; routing,
adapter, upgrade và handoff có kiểm tra local. Live provider switching, heartbeat,
council, recovery và concurrent writers chưa được nghiệm thu E2E. Capability và
đường nạp policy được ghi trong bảng trace bên dưới.

Đường offline vẫn có: `install <dir> --apply` không có `--paseo-home` chỉ stage
package; `prepare <request.json>` xuất create_agent arguments có role envelope.
Đường này không đăng ký profile hay tự tạo agent.

- [File map và contract](docs/contract.md)
- [Operating guide](docs/reference/agent-orchestration-complete-operating-guide.md)
- [Trace guide → policy, procedure và protocol](docs/guide-coverage.md)
- [Checklist nghiệm thu độc lập](docs/review-checklist.md)

Cơ chế host tham chiếu: [custom providers](https://paseo.sh/docs/custom-providers.md),
[agent profiles](https://paseo.sh/docs/agent-profiles.md),
[Codex app-server](https://learn.chatgpt.com/docs/app-server#threads).
