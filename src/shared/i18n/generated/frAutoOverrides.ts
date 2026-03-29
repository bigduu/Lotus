export const frAutoOverrides = {
  common: {
    saveAnyway: "Enregistrer quand même",
    parentDirectory: "Répertoire des parents",
    currentPath: "Chemin actuel :",
    cancel: "Annuler",
    ok: "D'ACCORD",
    apply: "Appliquer",
    save: "Sauvegarder",
    delete: "Supprimer",
    yes: "Oui",
    no: "Non",
    home: "Maison",
    download: "Télécharger",
    directory: "Annuaire",
    file: "Déposer",
  },
  chat: {
    workspace: {
      modalTitle: "Définir le chemin de l'espace de travail",
      invalidTitle: "Chemin d'accès à l'espace de travail non valide",
      issuesDetected: "Problèmes potentiels détectés avec le chemin de l'espace de travail :",
      confirmSaveInvalid: "Voulez-vous toujours enregistrer ce chemin ?",
      errorEnterPath: "Veuillez saisir un chemin d'accès à l'espace de travail",
      errorSaveFailed: "Échec de l'enregistrement du chemin de l'espace de travail",
      placeholder: "par ex. /Utilisateurs/alice/Espace de travail/MonProjet",
      browseFolder: "Parcourir le dossier",
      descriptionTitle: "Description du chemin de l'espace de travail",
      descriptionP1:
        "Définissez un chemin d'accès à l'espace de travail afin que les références de fichiers et les outils de l'espace de travail puissent résoudre les fichiers de manière fiable.",
      descriptionP2:
        "Choisissez un dossier de projet existant. Vous pouvez toujours continuer avec un chemin non valide, mais les fonctionnalités associées risquent de ne pas fonctionner correctement.",
      checkTitle: "Vérification du chemin de l'espace de travail",
      checkDescription: "La validation du chemin de l'espace de travail a échoué.",
      label: "Espace de travail",
    },
    folderBrowser: {
      title: "Sélectionnez le dossier de l'espace de travail",
      selectCurrent: "Sélectionnez le dossier actuel",
      emptyFolder: "Ce dossier est vide",
      tip: 'Astuce : cliquez sur un dossier pour y accéder, cliquez sur "Sélectionner le dossier actuel" pour confirmer',
    },
    input: {
      placeholder: "Envoyer un message...",
      placeholderWithReference: "Envoyer un message (inclut la référence)",
      placeholderWithWorkflows: "Envoyer un message... (tapez '/' pour les workflows)",
      toolCallsOnly: "Appels d'outils uniquement (outils autorisés : {{tools}})",
      autoPrefixMode:
        "Mode de préfixe automatique : {{prefix}} (tapez « / » pour sélectionner les outils)",
      toolSpecificMode: "Mode spécifique à l'outil (outils autorisés : {{tools}})",
      processingFiles: "Traitement des fichiers…",
      imageCountSingular: "Image {{count}}",
      imageCountPlural: "Images {{count}}",
      reasoning: {
        max: "Max.",
      },
    },
    actions: {
      regenerate: "Régénérer la réponse",
      retryFailed: "Réessayer la demande ayant échoué",
      retryOptions: "Options de nouvelle tentative",
      cancelRequest: "Annuler la demande",
      sendMessage: "Envoyer un message",
      copyMessage: "Copier le message",
      referenceMessage: "Message de référence",
      generateTitle: "Générer un titre IA",
      unpin: "Détacher",
      pin: "Épingle",
    },
    fileReference: {
      title: "@ Référence du fichier",
      setWorkspace: "Définir l'espace de travail",
      noMatches: "Aucun fichier correspondant trouvé",
      emptyDirectory: "Le répertoire est vide",
    },
    commandSelector: {
      types: {
        mcp: "PCM",
      },
    },
    streaming: {
      assistant: "Assistant",
    },
  },
  settings: {
    configTab: {
      toolsLoadFailed: "Échec du chargement des outils disponibles",
      toolsReloadSuccess: "Liste d'outils rechargée",
      toolsSaveSuccess: "Paramètres de l'outil enregistrés avec succès",
      toolsSaveFailed: "Échec de l'enregistrement des paramètres de l'outil",
      languageHindi: "hindi",
    },
    modelLimits: {
      placeholders: {
        vendor: "OpenAI / Google / Moonshot",
      },
      columns: {
        notes: "Remarques",
        actions: "Actes",
      },
    },
    systemPromptManager: {
      title: "Gestion des invites système",
      addButton: "Ajouter une invite",
      defaultPromptLocked:
        "Les invites système par défaut sont verrouillées et ne peuvent pas être modifiées.",
      updateSuccess: "Invite mise à jour avec succès",
      addSuccess: "Invite ajoutée avec succès",
      saveError: "Échec de l'enregistrement de l'invite. Veuillez réessayer.",
      deleteSuccess: "Invite supprimée avec succès",
      deleteError: "Échec de la suppression de l'invite. Veuillez réessayer.",
      deleteConfirm: "Êtes-vous sûr de supprimer cette invite ?",
      defaultTag: "Par défaut (verrouillé)",
      editTitle: "Modifier l'invite système",
      addTitle: "Ajouter une nouvelle invite système",
      nameLabel: "Nom de l'invite",
      nameRequired: "Veuillez saisir le nom de l'invite !",
      descriptionLabel: "Description rapide",
      descriptionRequired: "Veuillez saisir la description de l'invite !",
      contentLabel: "Contenu rapide",
      contentRequired: "Veuillez saisir le contenu de l'invite !",
    },
    envVars: {
      title: "Variables d'environnement",
      description:
        "Les variables sont injectées dans les processus de l'outil Bash. Les variables secrètes sont chiffrées au repos.",
      fetchError: "Échec du chargement des variables d'environnement",
      created: "Variable créée",
      updated: "Variable mise à jour",
      saveError: "Échec de l'enregistrement de la variable",
      deleted: "Variable supprimée",
      deleteError: "Échec de la suppression de la variable",
      addButton: "Ajouter une variable",
      noVars: "Aucune variable d'environnement configurée",
      addTitle: "Ajouter une variable d'environnement",
      editTitle: "Modifier une variable",
      nameRequired: "Le nom de la variable est obligatoire",
      nameInvalid:
        "Doit commencer par une lettre ou un trait de soulignement, suivi de lettres, de chiffres ou de traits de soulignement",
      valueRequired: "La valeur est requise pour les nouvelles variables",
      valueEditHint: "Laisser vide pour conserver la valeur existante",
      valuePlaceholder: "Entrez la valeur",
      valuePlaceholderEdit: "Entrez une nouvelle valeur ou laissez vide",
      secretHint:
        "Les variables secrètes sont chiffrées sur le disque et masquées dans l'interface utilisateur",
      descriptionPlaceholder: "Description facultative",
      deleteConfirm: "Supprimer cette variable ?",
      notSet: "(non réglé)",
      empty: "(vide)",
      save: "Sauvegarder",
      cancel: "Annuler",
      name: "Nom",
      value: "Valeur",
      secret: "Secrète",
      descriptionField: "Description",
      type: "Taper",
      plain: "Plaine",
      descriptionCol: "Description",
      actions: "Actes",
      yes: "Oui",
      no: "Non",
    },
    hooksTab: {
      mode: {
        ocr: "ROC (Windows)",
        vision: "Vision (LLM)",
        placeholder: "Espace réservé",
      },
      modeLabel: "Mode",
    },
    providerTab: {
      fastModel: "Modèle rapide (facultatif)",
      fastModelHelp:
        "Modèle moins cher/plus rapide pour les tâches légères telles que la génération de titres, la correction de sirène et la synthèse. Utilise le modèle par défaut lorsqu'il n'est pas défini.",
      visionModel: "Modèle de vision (facultatif)",
      visionModelHelp:
        "Modèle capable de vision pour la compréhension des images. Lorsque hooks.image_fallback.mode est défini sur « vision », ce modèle décrit les images sous forme de texte afin que les modèles contenant uniquement du texte puissent les comprendre. Utilise le modèle par défaut lorsqu'il n'est pas défini.",
      sameAsDefault: "Identique au modèle par défaut",
      providerNames: {
        openai: "OpenAI",
        anthropic: "Anthropique",
        gemini: "Gémeaux",
        copilot: "Copilote",
      },
    },
    mcpTab: {
      statusHelp: {
        connecting: "Le serveur démarre ou se reconnecte",
        ready: "Le serveur est connecté et sert les outils normalement",
        degraded: "Le serveur est partiellement disponible ; certains outils peuvent échouer",
        stopped: "Le serveur ne fonctionne pas",
        error: "Le serveur n'a pas pu démarrer ou a rencontré des erreurs d'exécution",
      },
    },
    metricsDashboard: {
      sessionsCount: "{{count}} séances",
      tokensAmount: "{{value}} jetons",
      sessionsTabLabel: "Séances ({{count}})",
      roundColumns: {
        tokens: "Jetons",
      },
      multiplierSuffix: "x",
      sessionDetail: {
        messages: "Messages",
      },
    },
    page: {
      tabs: {
        prompts: "Invites",
        mermaid: "Sirène",
        mcp: "PCM",
        sessions: "Séances",
        hooks: "Crochets",
      },
    },
    appTab: {
      languageHindi: "hindi",
    },
    modelMappingCard: {
      modelTypeOpus: "Opus",
      modelTypeSonnet: "Sonnet",
      modelTypeHaiku: "Haïku",
    },
    mermaidTab: {
      switchAuto: "Auto",
      flowchartCurveOptions: {
        cardinal: "Cardinal",
      },
    },
    schedulesTab: {
      columns: {
        actions: "Actes",
      },
      actions: {
        sessions: "Séances",
      },
    },
    sessionsTab: {
      id: "identifiant",
    },
    mcpServerTable: {
      columns: {
        actions: "Actes",
      },
      transportOptions: {
        sse: "ESS",
        stdio: "Stdio",
      },
    },
    mcpServerForm: {
      modeJson: "JSON",
      transportOptions: {
        stdio: "Stdio",
        sse: "ESS",
      },
      arguments: "Arguments",
    },
    metricsTable: {
      session: {
        columns: {
          session: "Session",
          tokens: "Jetons",
          messages: "Messages",
          action: "Action",
        },
      },
      forward: {
        columns: {
          id: "IDENTIFIANT",
          type: "Taper",
          tokens: "Jetons",
        },
      },
    },
    charts: {
      total: "Total",
      prompt: "Rapide",
      chat: "Chat",
    },
  },
  components: {
    markdown: {
      codeCopiedSuccess: "Code copié dans le presse-papier",
      copyFailed: "Échec de la copie",
    },
    jsonSchema: {
      noProperties: "Aucune propriété dans le schéma",
      field: "Champ",
      type: "Taper",
      required: "Requis",
      yes: "Oui",
      no: "Non",
      default: "Défaut",
      description: "Description",
    },
    imageGrid: {
      ocr: "ROC",
    },
    tokenUsage: {
      messages: "Messages",
      tokens: "jetons",
    },
    approval: {
      workflow: "Flux de travail",
    },
  },
} as const;
