"""Render reviewable Nginx configuration for a custom Workflow hostname."""
import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def render(domain, site_root, cert_dir, api_port, output):
    if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain):
        raise ValueError('Domain must be a plain lowercase DNS hostname')
    for path in (site_root, cert_dir):
        if not re.fullmatch(r'/[A-Za-z0-9_./-]+', path) or '..' in path.split('/'):
            raise ValueError('Expected an absolute Linux path without spaces or traversal')
    if not 1 <= api_port <= 65535:
        raise ValueError('Invalid API port')
    output.mkdir(parents=True, exist_ok=True)
    values = {'workflow_domain': domain, 'site_root': site_root.rstrip('/'), 'cert_dir': cert_dir.rstrip('/'), 'api_port': str(api_port)}
    for name in ('workflow-http.conf', 'workflow.conf'):
        text = (ROOT / 'image_service/deploy' / name).read_text(encoding='utf-8')
        for key, value in values.items():
            text = text.replace('{{' + key + '}}', value)
        (output / name).write_text(text, encoding='utf-8')
    (output / 'server.env.example').write_text('LOCAL_STUDIO_ORIGIN=https://' + domain + '\nLOCAL_STUDIO_WORKER_TOKEN=\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', default='workflow.strgo.com')
    parser.add_argument('--site-root', default='/var/www/strgo')
    parser.add_argument('--cert-dir')
    parser.add_argument('--api-port', type=int, default=8092)
    parser.add_argument('--output', type=Path, default=Path('artifacts/workflow-deploy'))
    args = parser.parse_args()
    render(args.domain, args.site_root, args.cert_dir or '/etc/letsencrypt/live/' + args.domain, args.api_port, args.output)
    print('Workflow deployment configuration prepared in ' + str(args.output.resolve()))


if __name__ == '__main__':
    main()
