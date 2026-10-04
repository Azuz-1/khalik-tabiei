#!/usr/bin/env python3
"""Static red-flag scan of a cloned skill/repo. Usage: python3 audit_skill.py PATH
Flags hidden Unicode, HTML comments in .md, pipe-to-shell, eval/exec, secret paths,
agent-steering phrases, base64 blobs, install hooks, binaries, and lists every domain.
Hits are leads to read by hand, not verdicts. Never run code from a repo before reading it."""
import os,re,sys,collections
HID=re.compile('[​-‏ -‮⁠-⁤⁦-⁩﻿]|[\U000e0000-\U000e007f]')
PAT={
 'pipe-to-shell':r'(curl|wget|iwr|irm)[^\n|]{0,200}\|\s*(ba|z)?sh|\|\s*iex|Invoke-Expression|powershell[^\n]{0,40}-e(nc)?\b',
 'eval/exec':r'\beval\(|\bexec\(|new Function\(|shell=True|os\.system\(|child_process|execSync|spawn\(',
 'secrets-paths':r'\.ssh/|id_rsa|\.aws/credentials|Login Data|Local State|wallet|keychain|\.env\b',
 'agent-steering':r'(?i)ignore (all |any )?(previous|prior) instructions|do not (tell|inform|mention)|don\'t (tell|mention)|without (asking|telling|confirm)|silently|you must (always|never)|override|system prompt',
 'b64-blob':r'[A-Za-z0-9+/]{200,}={0,2}',
 'postinstall':r'"(pre|post)install"\s*:',
}
root=sys.argv[1]
hits=collections.defaultdict(list); domains=collections.Counter(); binaries=[]; comments=[]
for dp,dn,fn in os.walk(root):
    if '.git' in dp.split(os.sep): continue
    for f in fn:
        p=os.path.join(dp,f); rel=os.path.relpath(p,root)
        b=open(p,'rb').read()
        if b'\x00' in b[:4000]: binaries.append((rel,len(b))); continue
        t=b.decode('utf-8','replace')
        for i,line in enumerate(t.splitlines(),1):
            if HID.search(line): hits['HIDDEN-UNICODE'].append(f'{rel}:{i}: {[hex(ord(c)) for c in HID.findall(line)][:5]}')
            for k,r in PAT.items():
                if re.search(r,line): hits[k].append(f'{rel}:{i}: {line.strip()[:160]}')
        if rel.endswith('.md'):
            for m in re.finditer(r'<!--(.*?)-->',t,re.S): comments.append(f'{rel}: {m.group(1).strip()[:200]}')
        for d in re.findall(r'https?://([A-Za-z0-9.-]+)',t): domains[d.lower()]+=1
print('== binaries:',binaries)
print('== md html comments:',len(comments)); [print('  ',c) for c in comments[:15]]
for k,v in hits.items():
    print(f'== {k}: {len(v)}'); [print('  ',x) for x in v[:25]]
print('== domains:',', '.join(f'{d}({n})' for d,n in domains.most_common(40)))
