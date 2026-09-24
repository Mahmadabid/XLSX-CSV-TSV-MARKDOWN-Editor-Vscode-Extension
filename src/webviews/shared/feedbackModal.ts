import { vscode } from './common';
import { Utils } from './utils';
import { Icons } from './icons';
import { I18n } from './i18n';

export class FeedbackModal {
    private static isInitialized = false;
    private static container: HTMLElement | null = null;
    private static overlay: HTMLElement | null = null;
    private static emailContainer: HTMLElement | null = null;
    private static emailInput: HTMLInputElement | null = null;

    public static initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.overlay = document.createElement('div');
        this.overlay.className = 'feedback-overlay hidden';
        document.body.appendChild(this.overlay);

        this.container = document.createElement('div');
        this.container.className = 'feedback-modal hidden';
        this.container.innerHTML = `
            <div class="feedback-header">
                <h2>Help & Feedback</h2>
                <button class="feedback-close" title="Close">${Icons.Cancel}</button>
            </div>
            <div class="feedback-body">
                <div class="github-section">
                    <p>For issues requiring follow-up or detailed discussion, we recommend creating a GitHub issue. This allows for better tracking and collaboration.</p>
                    <a class="github-issue-btn" href="#" id="githubIssueBtn">
                        <span>Create Issue on GitHub</span>
                    </a>
                </div>
                
                <form id="feedbackForm">
                    <div class="form-group">
                        <label>System Information</label>
                        <textarea id="feedbackSystemDetails" name="entry.1764429077" readonly rows="4"></textarea>
                    </div>

                    <div class="form-group">
                        <label>What is the primary reason for filling out this form? *</label>
                        <div class="radio-group">
                            <label class="radio-label">
                                <input type="radio" name="entry.1195554625" value="I need help or want to report an issue (Bug/Support)" required>
                                <span>Bug/Support</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="entry.1195554625" value="I want to provide general feedback on the existing product/service" required>
                                <span>General Feedback</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="entry.1195554625" value="I want to suggest a new feature or enhancement" required>
                                <span>Feature Suggestion</span>
                            </label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>How satisfied are you overall? *</label>
                        <div class="linear-scale">
                            <span>Very Dissatisfied</span>
                            <label><input type="radio" name="entry.1343045643" value="1" required> 1</label>
                            <label><input type="radio" name="entry.1343045643" value="2" required> 2</label>
                            <label><input type="radio" name="entry.1343045643" value="3" required> 3</label>
                            <label><input type="radio" name="entry.1343045643" value="4" required> 4</label>
                            <label><input type="radio" name="entry.1343045643" value="5" required> 5</label>
                            <span>Very Satisfied</span>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Please describe your issue or suggestion *</label>
                        <textarea name="entry.1542169572" required rows="5" placeholder="Describe your issue, bug, feedback, or feature suggestion..."></textarea>
                    </div>

                    <div class="form-group">
                        <label>Would you be open to a follow-up discussion? *</label>
                        <div class="radio-group">
                            <label class="radio-label">
                                <input type="radio" id="followUpYes" name="entry.730555287" value="Yes" required>
                                <span>Yes, I'd like to be contacted</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" id="followUpNo" name="entry.730555287" value="No" required>
                                <span>No, I prefer not to be contacted</span>
                            </label>
                        </div>
                    </div>

                    <div class="form-group hidden" id="emailContainer">
                        <label>Email Address *</label>
                        <input type="email" id="emailInput" name="entry.1168676234" placeholder="your.email@example.com">
                    </div>
                </form>
            </div>

            <div class="feedback-footer">
                <button type="button" class="btn-cancel" id="feedbackCancelBtn">Cancel</button>
                <button type="submit" class="btn-submit" id="feedbackSubmitBtn" form="feedbackForm">Submit</button>
            </div>

            <!-- Confirmation Popup -->
            <div id="feedbackWarningPopup" class="feedback-warning-popup hidden">
                <div class="warning-content">
                    <p>You have selected not to follow up, so you will not receive any information about fixes made or suggestions implemented.</p>
                    <div class="warning-actions">
                        <button type="button" class="btn-cancel" id="warningCancelBtn">Cancel</button>
                        <button type="button" class="btn-submit" id="warningSubmitBtn">Submit Anyway</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.container);

        this.bindEvents();

        // Listen for system details from extension
        window.addEventListener('message', (event) => {
            if (event.data.command === 'systemDetails') {
                const detailsArea = document.getElementById('feedbackSystemDetails') as HTMLTextAreaElement;
                if (detailsArea) {
                    const editorName = event.data.editorName || 'VS Code';
                    detailsArea.value = `Editor: ${editorName}\nVersion: ${event.data.vscodeVersion}\nExtension: ${event.data.extensionVersion}\nOS: ${event.data.osInfo}`;
                }
            } else if (event.data.command === 'feedbackResult') {
                const submitBtn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = I18n.t('feedback.submit', 'Submit');
                }
                if (event.data.ok) {
                    Utils.showToast(I18n.t('feedback.success', 'Feedback submitted successfully!'));
                    this.hide();
                    const form = document.getElementById('feedbackForm') as HTMLFormElement;
                    if (form) form.reset();
                    this.updateEmailVisibility();
                } else {
                    Utils.showToast(I18n.t('feedback.fail', 'Failed to submit feedback.'), false);
                }
            }
        });
    }

    private static bindEvents() {
        const closeBtn = this.container?.querySelector('.feedback-close');
        const cancelBtn = document.getElementById('feedbackCancelBtn');
        const overlay = this.overlay;

        const close = () => this.hide();
        closeBtn?.addEventListener('click', close);
        cancelBtn?.addEventListener('click', close);
        overlay?.addEventListener('click', close);

        const githubBtn = document.getElementById('githubIssueBtn');
        githubBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({
                command: 'openExternal',
                url: 'https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension/issues/new'
            });
        });

        const followUpYes = document.getElementById('followUpYes') as HTMLInputElement;
        const followUpNo = document.getElementById('followUpNo') as HTMLInputElement;
        this.emailContainer = document.getElementById('emailContainer');
        this.emailInput = document.getElementById('emailInput') as HTMLInputElement;

        followUpYes?.addEventListener('change', () => this.updateEmailVisibility());
        followUpNo?.addEventListener('change', () => this.updateEmailVisibility());

        const form = document.getElementById('feedbackForm') as HTMLFormElement;
        const warningPopup = document.getElementById('feedbackWarningPopup');
        const warningCancelBtn = document.getElementById('warningCancelBtn');
        const warningSubmitBtn = document.getElementById('warningSubmitBtn');

        form?.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            if (followUpNo?.checked) {
                warningPopup?.classList.remove('hidden');
            } else {
                this.submitForm(form);
            }
        });

        warningCancelBtn?.addEventListener('click', () => {
            warningPopup?.classList.add('hidden');
        });

        warningSubmitBtn?.addEventListener('click', () => {
            warningPopup?.classList.add('hidden');
            this.submitForm(form);
        });
    }

    private static updateEmailVisibility() {
        if (!this.emailContainer || !this.emailInput) return;

        const followUpYes = document.getElementById('followUpYes') as HTMLInputElement;

        if (followUpYes?.checked) {
            this.emailContainer.classList.remove('hidden');
            this.emailInput.required = true;
        } else {
            this.emailContainer.classList.add('hidden');
            this.emailInput.required = false;
            this.emailInput.value = '';
        }
    }

    private static submitForm(form: HTMLFormElement) {
        const submitBtn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = I18n.t('feedback.submitting', 'Submitting...');
        }

        const formData = new FormData(form);
        const data: Record<string, string> = {};
        formData.forEach((value, key) => {
            data[key] = value.toString();
        });

        vscode.postMessage({
            command: 'submitFeedback',
            data
        });
    }

    public static updateTranslations() {
        if (!this.container) return;
        const h2 = this.container.querySelector('.feedback-header h2');
        if (h2) h2.textContent = I18n.t('feedback.title', 'Help & Feedback');
        const closeBtn = this.container.querySelector('.feedback-close');
        if (closeBtn) closeBtn.setAttribute('title', I18n.t('feedback.close', 'Close'));
        const githubP = this.container.querySelector('.github-section p');
        if (githubP) githubP.textContent = I18n.t('feedback.githubText', 'For issues requiring follow-up or detailed discussion, we recommend creating a GitHub issue. This allows for better tracking and collaboration.');
        const githubBtnSpan = this.container.querySelector('#githubIssueBtn span');
        if (githubBtnSpan) githubBtnSpan.textContent = I18n.t('feedback.createIssue', 'Create Issue on GitHub');

        const formGroups = this.container.querySelectorAll('.form-group');
        if (formGroups.length >= 6) {
            const label0 = formGroups[0].querySelector('label');
            if (label0) label0.textContent = I18n.t('feedback.systemInfo', 'System Information');

            const label1 = formGroups[1].querySelector('label');
            if (label1) label1.textContent = I18n.t('feedback.reasonTitle', 'What is the primary reason for filling out this form? *');
            const radioSpans1 = formGroups[1].querySelectorAll('.radio-label span');
            if (radioSpans1[0]) radioSpans1[0].textContent = I18n.t('feedback.reasonBug', 'Bug/Support');
            if (radioSpans1[1]) radioSpans1[1].textContent = I18n.t('feedback.reasonGeneral', 'General Feedback');
            if (radioSpans1[2]) radioSpans1[2].textContent = I18n.t('feedback.reasonFeature', 'Feature Suggestion');

            const label2 = formGroups[2].querySelector('label');
            if (label2) label2.textContent = I18n.t('feedback.satisfactionTitle', 'How satisfied are you overall? *');
            const scaleSpans = formGroups[2].querySelectorAll('.linear-scale > span');
            if (scaleSpans[0]) scaleSpans[0].textContent = I18n.t('feedback.veryDissatisfied', 'Very Dissatisfied');
            if (scaleSpans[1]) scaleSpans[1].textContent = I18n.t('feedback.verySatisfied', 'Very Satisfied');

            const label3 = formGroups[3].querySelector('label');
            if (label3) label3.textContent = I18n.t('feedback.descTitle', 'Please describe your issue or suggestion *');
            const descArea = formGroups[3].querySelector('textarea');
            if (descArea) descArea.placeholder = I18n.t('feedback.descPlaceholder', 'Describe your issue, bug, feedback, or feature suggestion...');

            const label4 = formGroups[4].querySelector('label');
            if (label4) label4.textContent = I18n.t('feedback.followUpTitle', 'Would you be open to a follow-up discussion? *');
            const radioSpans4 = formGroups[4].querySelectorAll('.radio-label span');
            if (radioSpans4[0]) radioSpans4[0].textContent = I18n.t('feedback.followUpYes', "Yes, I'd like to be contacted");
            if (radioSpans4[1]) radioSpans4[1].textContent = I18n.t('feedback.followUpNo', 'No, I prefer not to be contacted');

            const label5 = formGroups[5].querySelector('label');
            if (label5) label5.textContent = I18n.t('feedback.email', 'Email Address *');
        }

        const cancelBtn = document.getElementById('feedbackCancelBtn');
        if (cancelBtn) cancelBtn.textContent = I18n.t('feedback.cancel', 'Cancel');
        const submitBtn = document.getElementById('feedbackSubmitBtn');
        if (submitBtn) submitBtn.textContent = I18n.t('feedback.submit', 'Submit');

        const warningP = this.container.querySelector('#feedbackWarningPopup .warning-content p');
        if (warningP) warningP.textContent = I18n.t('feedback.warningText', 'You have selected not to follow up, so you will not receive any information about fixes made or suggestions implemented.');
        const warningCancel = document.getElementById('warningCancelBtn');
        if (warningCancel) warningCancel.textContent = I18n.t('feedback.cancel', 'Cancel');
        const warningSubmit = document.getElementById('warningSubmitBtn');
        if (warningSubmit) warningSubmit.textContent = I18n.t('feedback.submitAnyway', 'Submit Anyway');
    }

    public static show() {
        if (!this.isInitialized) {
            this.initialize();
        }
        this.updateTranslations();

        // Request system details
        vscode.postMessage({ command: 'getSystemDetails' });

        this.overlay?.classList.remove('hidden');
        this.container?.classList.remove('hidden');

        // Allow animation
        setTimeout(() => {
            this.overlay?.classList.add('active');
            this.container?.classList.add('active');
        }, 10);
    }

    public static hide() {
        this.overlay?.classList.remove('active');
        this.container?.classList.remove('active');

        setTimeout(() => {
            this.overlay?.classList.add('hidden');
            this.container?.classList.add('hidden');
        }, 300); // match transition duration
    }
}
