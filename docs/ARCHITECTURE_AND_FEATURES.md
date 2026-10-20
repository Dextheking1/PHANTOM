# PHANTOM Architecture & Security Tooling

## Overview
PHANTOM is an autonomous, agentic offensive and defensive security AI workspace. It provides:
- Live streaming AI interaction with multi-turn tool calling and reasoning visibility.
- Comprehensive security connectors and mobile penetration testing integration (ADB, Frida, Scrcpy, Ghidra, Radare2, Nmap, Metasploit, SQLMap, Nuclei, Gobuster, Nikto, TShark, THC-Hydra, REA).
- Multi-agent coordination with specialized agents (Orchestrator, Planner, Executor, Compliance, Log Analysis, Threat Modeling).
- Full auditability: live command output streaming, tool execution history, and persistent activity cards.

## Features & Integration

### Security & Mobile Connectors
1. **Mobile Phone Integration**:
   - **ADB (Android Debug Bridge)**: Device discovery (`adb devices -l`), app inspection, shell access, APK installation, logcat analysis.
   - **Scrcpy**: Low-latency screen mirroring and remote control for Android devices.
   - **Frida**: Dynamic binary instrumentation, hook injection, and runtime tampering.
2. **Reverse Engineering & Disassembly**:
   - **Ghidra**: SRE decompilation, disassembly, and binary structure analysis.
   - **Radare2**: Command-line binary analysis, hex editing, and debugging.
   - **REA (Reverse Engineer Anything)**: Advanced reverse engineering MCP provider.
3. **Reconnaissance & Vulnerability Assessment**:
   - **Nmap**: Network host discovery, port scanning, and OS detection.
   - **Metasploit Framework**: Modular penetration testing and exploit verification.
   - **SQLMap**: Automatic SQL injection detection and exploitation engine.
   - **Nuclei**: Fast, template-based vulnerability scanning.
   - **Gobuster**: Directory, DNS subdomain, and vhost fuzzing.
   - **Nikto**: Web server security scanner.
   - **TShark**: Terminal packet capture and deep network inspection.
   - **THC-Hydra**: High-speed network service authentication testing.

### Tool Execution & Safety
- **Elevated Execution**: Commands requiring elevated permissions automatically utilize secure sudo wrapping with user credentials stored locally.
- **Persistent Tool Activity**: Tool calls, arguments, durations, and outputs are preserved in both real-time and session history with interactive inspection badges on assistant replies.
- **Reactivation Support**: Connectors can be re-verified or reactivated anytime with a single click in the Connectors settings panel.
