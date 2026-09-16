{ pkgs, lib, config, inputs, ... }:

{

  # https://devenv.sh/packages/
  packages = [ pkgs.git pkgs.jq ];

  languages.javascript.enable = true;
  languages.javascript.npm.enable = true;

  scripts.watch.exec = ''
    npm run watch
  '';

  # The build stamps the version itself (build/stamp-version.js); no sed.
  scripts.copy-to-ha.exec = ''
    npm run build
    sudo cp dist/live-track-map-card.js /var/lib/hass/www
  '';


  scripts.get-version.exec = ''
    jq -r '.version' package.json
  '';

  scripts.release-github.exec = ''
    npm run build
    npm run check-release
  '';

  scripts.release.exec = ''
    devenv test
    npm run build
    outstanding_changes=$(git status --porcelain=v1 2>/dev/null | wc -l)
    if [ $outstanding_changes -gt 0 ];
    then
      echo Aborting, uncommitted changes.
      git status
      exit 1
    fi
    npm run check-release
    VERSION=$(get-version)
    echo $VERSION

    git tag v$VERSION
  '';

  enterShell = ''
    npm install
  '';

  enterTest = ''
    npm run build
    npm run lint
    npm run test
  '';
  

}
