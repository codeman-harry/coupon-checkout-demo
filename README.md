# 优惠券结算 Demo

本地运行的单商品 Web 应用，包含数量输入、优惠码使用与移除、模拟订单创建、订单详情和历史订单。订单保存在 SQLite 中，页面金额单位为元。

运行要求：Python 3.10+，无需安装第三方 Python 包。Windows 管理脚本使用 PowerShell 7。

## 启动和管理

在 PowerShell 中切换到本目录后执行：

```powershell
.\manage.ps1 start
.\manage.ps1 status
.\manage.ps1 stop
.\manage.ps1 restart
.\manage.ps1 logs
```

默认访问地址为 [http://localhost:30100/](http://localhost:30100/)，服务只监听本机回环地址。关闭浏览器不会停止后台服务。

也可以在终端前台启动：

```powershell
python server.py --port 30100
```

## 使用

1. 在结算页输入数量，查看商品小计。
2. 输入优惠码并点击“使用”，或通过“移除”取消优惠码。
3. 点击“创建订单”查看确认结果。
4. 复制订单地址、刷新页面或进入“订单记录”重新查看订单。
5. 开始下一条测试时，返回结算页并点击“重新开始”，将数量和优惠码恢复为初始状态。

应用中的订单为模拟数据，无需账号、支付或外部服务。

## 数据和运行信息

- `.runtime/orders.sqlite3`：本机模拟订单。
- `.runtime/stdout.log`、`.runtime/stderr.log`：后台进程日志。
- `.runtime/server.pid`：后台进程标识。
- `.runtime/deployment.json`：启动时的版本和构建标识。
- `/api/health`：当前应用、版本和构建信息。

“重新开始”只清理当前结算状态，保留历史订单。需要清空全部模拟订单时执行：

```powershell
.\manage.ps1 reset
```

该命令停止本 Demo、清空本 Demo 的订单表，再启动服务。
